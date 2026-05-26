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

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
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

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
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
