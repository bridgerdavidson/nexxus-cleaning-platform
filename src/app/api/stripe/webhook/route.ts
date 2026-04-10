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

      case 'transfer.reversed': {
        const transfer = event.data.object as Stripe.Transfer;
        await handleTransferReversed(supabaseAdmin, transfer);
        break;
      }

      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout;
        await handlePayoutPaid(supabaseAdmin, payout, event.account ?? null);
        break;
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout;
        await handlePayoutFailed(supabaseAdmin, payout, event.account ?? null);
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

async function handleTransferReversed(
  supabaseAdmin: unknown,
  transfer: Stripe.Transfer
) {
  const supabase = supabaseAdmin as ReturnType<typeof createClient>;
  console.log('Transfer reversed:', transfer.id);

  const { data: existingPayout, error: findError } = await supabase
    .from('payouts')
    .select('id')
    .eq('stripe_transfer_id', transfer.id)
    .single();

  if (findError || !existingPayout) {
    console.log('No payout record found for reversed transfer:', transfer.id);
    return;
  }

  const { error: updateError } = await supabase
    .from('payouts')
    .update({
      status: 'reversed',
      reversed_at: new Date().toISOString(),
    })
    .eq('id', existingPayout.id);

  if (updateError) {
    console.error('Error marking payout as reversed:', updateError);
  } else {
    console.log('Payout marked as reversed for transfer:', transfer.id);
  }
}

/**
 * Handle payout.paid from a connected account — money landed in the cleaner's bank.
 * Connect events arrive with event.account set to the connected account ID.
 * Stripe batches balance into a single payout, so we mark all eligible rows.
 *
 * Resilience notes:
 * - If event.account is missing (webhook misconfiguration), we skip and log clearly.
 * - We match by stripe_transfer_id via balance transaction lookup when possible,
 *   but fall back to marking all un-assigned 'paid' rows for the cleaner.
 * - The reconcile-payouts endpoint handles catch-up for any missed webhooks.
 */
async function handlePayoutPaid(
  supabaseAdmin: unknown,
  payout: Stripe.Payout,
  connectedAccountId: string | null
) {
  const supabase = supabaseAdmin as ReturnType<typeof createClient>;
  const arrivalDate = new Date(payout.arrival_date * 1000).toISOString();

  console.log('Payout paid webhook received:', {
    payoutId: payout.id,
    connectedAccountId,
    arrivalDate,
    amount: payout.amount,
    currency: payout.currency,
    status: payout.status,
  });

  if (!connectedAccountId) {
    console.warn(
      'payout.paid event missing event.account — this usually means the webhook is not ' +
      'configured as a Connect webhook. Enable "Listen to events on Connected accounts" ' +
      'in your Stripe webhook settings. Payout will be caught by the reconcile endpoint.',
      { payoutId: payout.id }
    );
    return;
  }

  // Find the cleaner by their Stripe Connect account
  const { data: cleaner, error: cleanerError } = await supabase
    .from('cleaner_profiles')
    .select('id')
    .eq('stripe_connect_account_id', connectedAccountId)
    .single();

  if (cleanerError || !cleaner) {
    console.log('No cleaner found for connected account:', connectedAccountId, cleanerError?.message);
    return;
  }

  // Try to get the specific transfer IDs from this bank payout so we can
  // do a precise match. Falls back gracefully if balance transaction lookup fails.
  let transferIds: string[] = [];
  try {
    const { getPayoutTransferIds } = await import('@/lib/stripe');
    transferIds = await getPayoutTransferIds(connectedAccountId, payout.id);
    console.log(`payout.paid ${payout.id}: resolved ${transferIds.length} transfer(s):`, transferIds);
  } catch (err) {
    console.warn('payout.paid: could not fetch balance transactions, will use fallback:', err);
  }

  const bankPaidUpdate = {
    status: 'bank_paid' as const,
    stripe_payout_id: payout.id,
    bank_paid_at: arrivalDate,
  };

  let count = 0;

  if (transferIds.length > 0) {
    // Precise: only update rows whose transfers are in this bank payout
    const { data: updatedRows, error: updateError } = await supabase
      .from('payouts')
      .update(bankPaidUpdate)
      .eq('cleaner_id', cleaner.id)
      .eq('status', 'paid')
      .in('stripe_transfer_id', transferIds)
      .select('id');

    if (updateError) {
      console.error('payout.paid: DB error during precise update:', updateError);
    } else {
      count = (updatedRows ?? []).length;
    }

    // If precise matching found nothing, fall back to unassigned rows
    if (count === 0) {
      console.warn('payout.paid: precise transfer match updated 0 rows, trying fallback for cleaner:', cleaner.id);
      const { data: fallbackRows, error: fallbackError } = await supabase
        .from('payouts')
        .update(bankPaidUpdate)
        .eq('cleaner_id', cleaner.id)
        .eq('status', 'paid')
        .is('stripe_payout_id', null)
        .select('id');

      if (fallbackError) {
        console.error('payout.paid: DB error during fallback update:', fallbackError);
      } else {
        count = (fallbackRows ?? []).length;
      }
    }
  } else {
    // Fallback: mark all 'paid' rows not yet assigned a stripe_payout_id
    const { data: updatedRows, error: updateError } = await supabase
      .from('payouts')
      .update(bankPaidUpdate)
      .eq('cleaner_id', cleaner.id)
      .eq('status', 'paid')
      .is('stripe_payout_id', null)
      .select('id');

    if (updateError) {
      console.error('payout.paid: DB error during fallback update:', updateError);
    } else {
      count = (updatedRows ?? []).length;
    }
  }

  if (count === 0) {
    console.warn('payout.paid: no eligible payout rows updated for cleaner:', cleaner.id,
      'payout:', payout.id, '— rows may already be bank_paid or no matching rows exist');
  } else {
    console.log(`payout.paid: marked ${count} row(s) as bank_paid for cleaner ${cleaner.id}, payout ${payout.id}`);
  }
}

async function handlePayoutFailed(
  supabaseAdmin: unknown,
  payout: Stripe.Payout,
  connectedAccountId: string | null
) {
  const supabase = supabaseAdmin as ReturnType<typeof createClient>;

  console.log('Payout failed webhook received:', {
    payoutId: payout.id,
    connectedAccountId,
    failureCode: payout.failure_code,
    failureMessage: payout.failure_message,
  });

  if (!connectedAccountId) {
    console.warn('payout.failed event missing event.account — Connect webhook not configured as connected account listener.');
    return;
  }

  const { data: cleaner, error: cleanerError } = await supabase
    .from('cleaner_profiles')
    .select('id')
    .eq('stripe_connect_account_id', connectedAccountId)
    .single();

  if (cleanerError || !cleaner) {
    console.log('No cleaner found for connected account on payout.failed:', connectedAccountId);
    return;
  }

  // If a payout fails after we already assigned its ID, revert those rows
  // back to 'paid' (still in Stripe balance, not yet in bank).
  const { data: revertedRows, error: updateError } = await supabase
    .from('payouts')
    .update({
      status: 'paid',
      stripe_payout_id: null,
      bank_paid_at: null,
    })
    .eq('cleaner_id', cleaner.id)
    .eq('stripe_payout_id', payout.id)
    .select('id');

  if (updateError) {
    console.error('Error reverting payouts after payout.failed:', updateError);
  } else {
    const count = (revertedRows ?? []).length;
    if (count === 0) {
      console.log('payout.failed: no rows were reverted (may not have been assigned yet):', payout.id);
    } else {
      console.log(`payout.failed: reverted ${count} row(s) back to paid for cleaner ${cleaner.id}, payout ${payout.id}`);
    }
  }
}
