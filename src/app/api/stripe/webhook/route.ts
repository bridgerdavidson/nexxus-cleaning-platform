import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { constructWebhookEvent } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { dispatchStripeEvent } from '@/lib/payments/dispatchStripeEvent';
import {
  claimWebhookEvent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/payments/webhookIdempotency';
import Stripe from 'stripe';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }

  // Platform-account events and connected-account (Connect) events are delivered by Stripe with
  // different signing secrets when they come from separate Dashboard endpoints. Verify against
  // either: STRIPE_WEBHOOK_SECRET (platform: payment_intent.*, charge.*, refund.*, …) and the
  // optional STRIPE_CONNECT_WEBHOOK_SECRET (connected: account.updated, payout.paid/failed). If a
  // single endpoint carries both under one secret, only STRIPE_WEBHOOK_SECRET is needed.
  const webhookSecrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter((s): s is string => !!s);
  if (webhookSecrets.length === 0) {
    console.error('No webhook signing secret configured (STRIPE_WEBHOOK_SECRET)');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Raw body + signature verification (this stays in the route — it needs the raw request
  // body and is itself a security boundary).
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    console.error('Missing stripe-signature header');
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event | null = null;
  let verifyError: unknown = null;
  for (const secret of webhookSecrets) {
    try {
      event = constructWebhookEvent(body, signature, secret);
      break;
    } catch (err) {
      verifyError = err;
    }
  }
  if (!event) {
    console.error('Webhook signature verification failed:', verifyError);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Reject events whose mode doesn't match this deployment's Stripe keys. A test-mode
  // signing secret leaking into a production endpoint (or a live secret into a preview)
  // would otherwise let a signed test event drive real settlement. Tie the expected mode
  // to the secret key (sk_live_/rk_live_ vs test) rather than NODE_ENV — Vercel preview
  // deploys run with NODE_ENV=production but test-mode Stripe keys.
  const expectLive = process.env.STRIPE_SECRET_KEY?.includes('_live_') ?? false;
  if (event.livemode !== expectLive) {
    console.error(
      `Webhook livemode mismatch: event.livemode=${event.livemode}, expected ${expectLive} — ignoring ${event.type} ${event.id}`,
    );
    return NextResponse.json({ error: 'Livemode mismatch' }, { status: 400 });
  }

  // Idempotency: claim the event before acting. A previously-processed event short-circuits;
  // a never-finished one is allowed to reprocess (handlers are idempotent). A transient failure
  // to record the claim throws — return 500 so Stripe retries rather than processing unclaimed.
  let claim;
  try {
    claim = await claimWebhookEvent(supabaseAdmin, {
      id: event.id,
      type: event.type,
      accountId: event.account ?? null,
    });
  } catch (err) {
    console.error('Failed to claim webhook event:', err);
    return NextResponse.json({ error: 'Failed to record webhook event' }, { status: 500 });
  }
  if (claim === 'duplicate') {
    console.log('Duplicate webhook delivery, skipping:', event.id, event.type);
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log('Received Stripe webhook event:', event.type, event.id);

  try {
    await dispatchStripeEvent(supabaseAdmin, event);
    await markWebhookProcessed(supabaseAdmin, event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    // Record the failure for the dead-letter sweep and return 500 so Stripe retries soon.
    // The retry will reprocess (the row is left non-'processed'); the reconciliation sweep
    // is the final backstop if Stripe gives up.
    console.error('Error processing webhook:', error);
    await markWebhookFailed(
      supabaseAdmin,
      event.id,
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
