import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { constructWebhookEvent, createConnectTransfer } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
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
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    );
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('Missing stripe-signature header');
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    console.log('Received Stripe webhook event:', event.type);

    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentSucceeded(supabaseAdmin, paymentIntent);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentFailed(supabaseAdmin, paymentIntent);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handlePaymentIntentSucceeded(
  supabaseAdmin: unknown,
  paymentIntent: Stripe.PaymentIntent
) {
  const supabase = supabaseAdmin as ReturnType<typeof createClient>;
  console.log('PaymentIntent succeeded:', paymentIntent.id);

  const appointmentId = paymentIntent.metadata?.appointment_id;

  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  // Update payment record
  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    
    // Try to find and update by appointment_id as fallback
    const { error: fallbackError } = await supabase
      .from('payments')
      .update({
        status: 'paid',
        stripe_payment_intent_id: paymentIntent.id,
        paid_at: new Date().toISOString(),
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');

    if (fallbackError) {
      console.error('Fallback update also failed:', fallbackError);
    }
  }

  console.log('Payment record updated for appointment:', appointmentId);

  // --- Automatic cleaner payout via Stripe Connect ---
  try {
    const { data: appointment } = await supabase
      .from('appointments')
      .select('cleaner_id, organization_id, total_price')
      .eq('id', appointmentId)
      .single();

    if (!appointment?.cleaner_id) {
      console.log('No cleaner assigned to appointment, skipping payout');
      return;
    }

    const { data: cleanerProfile } = await supabase
      .from('cleaner_profiles')
      .select('stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent')
      .eq('id', appointment.cleaner_id)
      .single();

    if (!cleanerProfile) {
      console.log('Cleaner profile not found, skipping payout');
      return;
    }

    const payoutPercent = Number(cleanerProfile.payout_percent);
    if (
      !cleanerProfile.stripe_connect_account_id ||
      !cleanerProfile.stripe_connect_onboarding_complete ||
      payoutPercent <= 0
    ) {
      console.log('Cleaner payout not configured (no Connect account, onboarding incomplete, or 0% payout). Skipping transfer.', {
        hasAccount: !!cleanerProfile.stripe_connect_account_id,
        onboardingComplete: cleanerProfile.stripe_connect_onboarding_complete,
        payoutPercent,
      });
      return;
    }

    const jobPrice = Number(appointment.total_price);
    const cleanerAmountCents = Math.round(jobPrice * (payoutPercent / 100) * 100);

    if (cleanerAmountCents <= 0) {
      console.log('Computed cleaner payout is $0, skipping transfer');
      return;
    }

    // Retrieve the charge ID from the PaymentIntent (required for source_transaction)
    const chargeId = paymentIntent.latest_charge as string | null;
    if (!chargeId) {
      console.error('No charge found on PaymentIntent, cannot create transfer');
      return;
    }

    const transfer = await createConnectTransfer(
      cleanerAmountCents,
      cleanerProfile.stripe_connect_account_id,
      chargeId,
      appointmentId
    );

    console.log('Connect transfer created:', transfer.id, `$${(cleanerAmountCents / 100).toFixed(2)} to ${cleanerProfile.stripe_connect_account_id}`);

    // Upsert payout record
    const payoutData = {
      organization_id: appointment.organization_id || null,
      cleaner_id: appointment.cleaner_id,
      appointment_id: appointmentId,
      amount: cleanerAmountCents / 100,
      status: 'paid',
      stripe_transfer_id: transfer.id,
      payout_percent_snapshot: payoutPercent,
      paid_at: new Date().toISOString(),
    };

    const { data: existingPayout } = await supabase
      .from('payouts')
      .select('id')
      .eq('appointment_id', appointmentId)
      .single();

    if (existingPayout) {
      await supabase.from('payouts').update(payoutData).eq('id', existingPayout.id);
    } else {
      await supabase.from('payouts').insert(payoutData);
    }

    console.log('Payout record saved for appointment:', appointmentId);
  } catch (payoutError) {
    // Transfer failure should not break the payment success flow
    console.error('Error processing cleaner payout:', payoutError);
  }
}

async function handlePaymentIntentFailed(
  supabaseAdmin: unknown,
  paymentIntent: Stripe.PaymentIntent
) {
  const supabase = supabaseAdmin as ReturnType<typeof createClient>;
  console.log('PaymentIntent failed:', paymentIntent.id);
  console.log('Failure reason:', paymentIntent.last_payment_error?.message);

  const appointmentId = paymentIntent.metadata?.appointment_id;

  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  // Update payment record to failed
  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'failed',
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    
    // Try to find and update by appointment_id as fallback
    const { error: fallbackError } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        stripe_payment_intent_id: paymentIntent.id,
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');

    if (fallbackError) {
      console.error('Fallback update also failed:', fallbackError);
    }
  }

  console.log('Payment marked as failed for appointment:', appointmentId);
}


