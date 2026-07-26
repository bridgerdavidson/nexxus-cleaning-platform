/**
 * Stripe webhook event dispatcher (extracted from the webhook route in Phase 4b).
 *
 * A single `dispatchStripeEvent(supabase, event)` entry point routes every event type to a
 * focused handler. Keeping it out of the route lets two callers share it:
 *   1. the live webhook (`/api/stripe/webhook`)
 *   2. the dead-letter / reconciliation sweep, which re-fetches a failed event via
 *      `stripe.events.retrieve(id)` and re-dispatches it.
 *
 * Handlers are idempotent and state-guarded so duplicate or out-of-order delivery is safe.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { createConnectTransfer } from '@/lib/stripe';
import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { settleSelfPay } from '@/lib/payments/settleSelfPay';
import { chargeCompletedAppointmentAuto } from './chargeCompletedAppointment';
import { refundCancelledInflightCharge } from './refundCancelledCharge';
import { clawbackCleanerPayout, reverseJobTransfersForRefund } from './clawback';
import { recordPaymentEvent } from '@/lib/payments/events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { formatUserName } from '@/lib/formatName';
import { mapSubscriptionStatus } from '@/lib/payments/orgBilling';

export async function dispatchStripeEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    case 'payment_intent.processing':
      await handlePaymentIntentProcessing(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    case 'payment_intent.canceled':
      await handlePaymentIntentCanceled(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    case 'setup_intent.succeeded':
      await handleSetupIntentSucceeded(supabase, event.data.object as Stripe.SetupIntent);
      break;
    case 'charge.refunded':
      await handleChargeRefunded(supabase, event.data.object as Stripe.Charge, event.id);
      break;
    case 'charge.failed':
      await handleChargeFailed(supabase, event.data.object as Stripe.Charge);
      break;
    case 'charge.dispute.created':
      await handleChargeDisputeCreated(supabase, event.data.object as Stripe.Dispute, event.id);
      break;
    case 'charge.dispute.closed':
      await handleChargeDisputeClosed(supabase, event.data.object as Stripe.Dispute, event.id);
      break;
    case 'application_fee.refunded':
      await handleApplicationFeeRefunded(supabase, event.data.object as Stripe.ApplicationFee);
      break;
    case 'transfer.reversed':
      await handleTransferReversed(supabase, event.data.object as Stripe.Transfer);
      break;
    case 'payout.paid':
      await handlePayoutPaid(supabase, event.data.object as Stripe.Payout, event.account ?? null);
      break;
    case 'payout.failed':
      await handlePayoutFailed(supabase, event.data.object as Stripe.Payout, event.account ?? null);
      break;
    case 'account.updated':
      await handleAccountUpdated(supabase, event.data.object as Stripe.Account);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpsert(supabase, event.data.object as Stripe.Subscription, event.id, event.type);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription, event.id);
      break;
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      await handleInvoiceEvent(supabase, event.data.object as Stripe.Invoice, event.id, event.type);
      break;
    case 'refund.failed':
    case 'refund.updated':
      await handleRefundStatusChange(supabase, event.data.object as Stripe.Refund, event.id);
      break;
    case 'setup_intent.setup_failed':
      await handleSetupIntentSetupFailed(supabase, event.data.object as Stripe.SetupIntent);
      break;
    case 'payout.canceled':
      // A canceled payout never reached the cleaner's bank — revert it exactly like a failure
      // (only payout.failed did this before, so a Stripe-canceled payout left a row falsely bank_paid).
      await handlePayoutFailed(supabase, event.data.object as Stripe.Payout, event.account ?? null);
      break;
    case 'radar.early_fraud_warning.created':
      await handleEarlyFraudWarning(supabase, event.data.object as Stripe.Radar.EarlyFraudWarning, event.id);
      break;
    case 'review.opened':
    case 'review.closed':
      await handleReview(supabase, event.data.object as Stripe.Review, event.id, event.type);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

/** Resolve our payment row (+ org/appointment) from a Stripe PaymentIntent id. */
async function findPaymentByIntent(supabase: SupabaseClient, paymentIntentId: string | null) {
  if (!paymentIntentId) return null;
  const { data } = await supabase
    .from('payments')
    .select('id, organization_id, appointment_id, status, amount')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  return data as
    | {
        id: string;
        organization_id: string;
        appointment_id: string;
        status: string;
        amount: number | string;
      }
    | null;
}

function idFromExpandable<T extends { id: string }>(v: string | T | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

async function handlePaymentIntentSucceeded(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  console.log('PaymentIntent succeeded:', paymentIntent.id);

  const appointmentId = paymentIntent.metadata?.appointment_id;
  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  // Out-of-order guard (audit H2): charge.refunded can arrive BEFORE payment_intent.succeeded
  // (an out-of-band Dashboard refund, or plain webhook reordering). That delivery already marked
  // the row 'refunded'; clobbering it back to 'paid' would re-arm settlement and pay the tenant
  // and cleaner out of money the payer already got back. Mirror the PI status and stop.
  const existingPayment = await findPaymentByIntent(supabase, paymentIntent.id);
  if (existingPayment?.status === 'refunded') {
    await supabase
      .from('payments')
      .update({ payment_intent_status: paymentIntent.status })
      .eq('id', existingPayment.id);
    await recordPaymentEvent(supabase, {
      paymentId: existingPayment.id,
      appointmentId,
      organizationId: existingPayment.organization_id,
      eventType: 'settlement_skipped_refunded',
      prevStatus: 'refunded',
      actor: 'webhook',
      amount: paymentIntent.amount_received ?? paymentIntent.amount ?? 0,
      payload: { payment_intent_id: paymentIntent.id, source: 'payment_intent.succeeded' },
    });
    console.log('payment_intent.succeeded after a refund: left row refunded, skipped settlement');
    return;
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'paid',
      paid_at: nowIso,
      captured_at: nowIso,
      payment_intent_status: paymentIntent.status,
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    const { error: fallbackError } = await supabase
      .from('payments')
      .update({
        status: 'paid',
        stripe_payment_intent_id: paymentIntent.id,
        paid_at: nowIso,
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');
    if (fallbackError) console.error('Fallback update also failed:', fallbackError);
  }

  console.log('Payment record updated for appointment:', appointmentId);

  // A job debit that settled AFTER the appointment was cancelled (e.g. an in-flight ACH debit, or
  // a completion charge that raced a cancel) must be refunded, not settled: the payer owes nothing
  // for a cancelled job. The CANCELLATION FEE charge legitimately succeeds on a cancelled
  // appointment (it settles to the tenant below), so only `charge_kind === 'completion'` routes
  // here; legacy charges (no charge_kind metadata) keep their existing behavior.
  if (paymentIntent.metadata?.charge_kind === 'completion') {
    const { data: statusRow } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', appointmentId)
      .maybeSingle();
    if ((statusRow as { status: string } | null)?.status === 'cancelled') {
      const result = await refundCancelledInflightCharge(supabase, {
        appointmentId,
        paymentIntentId: paymentIntent.id,
        actor: 'webhook',
      });
      console.log('Cancelled-job debit refunded instead of settled:', result);
      return;
    }
  }

  // Org self-pay (no on_behalf_of): the org paid for its OWN cleaning. Settle the single cleaner
  // transfer from the platform balance — no tenant remainder, no platform fee, cleaner gets the
  // exact cut (the gross-up overshoot stays on the platform). This MUST run before the
  // `on_behalf_of` check below: a self-pay PI has no on_behalf_of and would otherwise fall through
  // to the legacy path and pay the cleaner the wrong amount.
  if (paymentIntent.metadata?.self_pay === 'true') {
    const result = await settleSelfPay(
      supabase,
      appointmentId,
      (paymentIntent.latest_charge as string | null) ?? null,
    );
    console.log('Self-pay settlement:', result);
    return;
  }

  // New multi-tenant flow (separate charges and transfers): the charge is created on the
  // platform with `on_behalf_of` set, so the captured funds are on the PLATFORM balance. Settle
  // distributes them — tenant remainder → tenant, cleaner % → cleaner — on the AMOUNT CAPTURED.
  // (Legacy platform-as-merchant charges have no on_behalf_of and fall through to the path below.)
  if (paymentIntent.on_behalf_of) {
    const result = await settleCleanerPayout(
      supabase,
      appointmentId,
      (paymentIntent.latest_charge as string | null) ?? null,
      paymentIntent.amount_received ?? undefined,
      paymentIntent.id,
    );
    console.log('Separate charges/transfers settlement:', result);
    return;
  }

  // --- Automatic cleaner payout via Stripe Connect (legacy platform-as-merchant flow) ---
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
      console.log('Cleaner payout not configured. Skipping transfer.', {
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

    const chargeId = paymentIntent.latest_charge as string | null;
    if (!chargeId) {
      console.error('No charge found on PaymentIntent, cannot create transfer');
      return;
    }

    const transfer = await createConnectTransfer(
      cleanerAmountCents,
      cleanerProfile.stripe_connect_account_id,
      chargeId,
      appointmentId,
    );

    console.log('Connect transfer created:', transfer.id);

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
    console.error('Error processing cleaner payout:', payoutError);
  }
}

async function handlePaymentIntentFailed(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  console.log('PaymentIntent failed:', paymentIntent.id, paymentIntent.last_payment_error?.message);

  const appointmentId = paymentIntent.metadata?.appointment_id;
  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  // A LATE failure matters: a us_bank_account (ACH) debit can SUCCEED, settle, and pay the cleaner,
  // then RETURN days later as payment_intent.payment_failed. Don't clobber a paid/refunded row back
  // to 'failed' (that hides that money moved + was settled); instead record the return, claw back
  // the cleaner payout, and alert admins.
  const existing = await findPaymentByIntent(supabase, paymentIntent.id);
  const organizationId = paymentIntent.metadata?.organization_id ?? existing?.organization_id ?? null;

  if (existing && (existing.status === 'paid' || existing.status === 'refunded')) {
    await supabase
      .from('payments')
      .update({ payment_intent_status: paymentIntent.status })
      .eq('id', existing.id);
    await recordPaymentEvent(supabase, {
      paymentId: existing.id,
      appointmentId,
      organizationId,
      eventType: 'late_payment_failure',
      prevStatus: existing.status,
      actor: 'webhook',
      amount: paymentIntent.amount ?? 0,
      payload: {
        payment_intent_id: paymentIntent.id,
        error: paymentIntent.last_payment_error?.message ?? null,
      },
    });
    // Auto-reverse the cleaner payout (mirrors the dispute-lost clawback). Idempotent + never throws.
    await clawbackCleanerPayout(supabase, {
      appointmentId,
      actor: 'webhook',
      reason: 'ach_return',
      paymentId: existing.id,
      organizationId,
    });
    const ctx = await loadNotificationContext(supabase, { appointmentId });
    await recordNotificationEvent(supabase, {
      event_type: 'authorization_failed',
      appointment_id: appointmentId,
      organization_id: organizationId,
      payload: { ...ctx, audience: 'admin', amount_cents: paymentIntent.amount ?? 0 },
    });
    return;
  }

  // Pre-settlement failure (a declined hold, or an ACH debit that failed before it cleared): mark
  // the revenue row failed so the admin pill reads "Failed".
  const { error: updateError } = await supabase
    .from('payments')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    const { error: fallbackError } = await supabase
      .from('payments')
      .update({ status: 'failed', stripe_payment_intent_id: paymentIntent.id })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');
    if (fallbackError) console.error('Fallback update also failed:', fallbackError);
  }

  console.log('Payment marked as failed for appointment:', appointmentId);

  // A self-pay payment failure (a card charge decline or a bank/ACH debit that bounced before
  // settling) surfaces only here: the charge path records the decline in the ledger but does not
  // notify inline, so alert the org admins. Homeowner card failures carry no self_pay metadata, so
  // they never reach this block (they surface in "Payments needing attention" instead).
  if (paymentIntent.metadata?.self_pay === 'true') {
    const ctx = await loadNotificationContext(supabase, { appointmentId });
    await recordNotificationEvent(supabase, {
      event_type: 'authorization_failed',
      appointment_id: appointmentId,
      organization_id: organizationId,
      payload: { ...ctx, audience: 'admin', amount_cents: paymentIntent.amount ?? 0 },
    });
  }
}

/**
 * Handle payment_intent.processing — a bank (ACH) debit was submitted and is clearing (~4
 * business days until payment_intent.succeeded). Mirror it onto the revenue row so the cleaner's
 * "Awaiting customer payment" view and the reconcile sweep treat it as in-flight, not stuck or
 * failed. Cards never enter `processing`. Guarded to `pending`/`processing` so it can never
 * regress a row that already settled (paid) or failed.
 */
async function handlePaymentIntentProcessing(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  const appointmentId = paymentIntent.metadata?.appointment_id;
  if (!appointmentId) return;
  await supabase
    .from('payments')
    .update({ status: 'processing', payment_intent_status: paymentIntent.status })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .eq('payment_type', 'revenue')
    .in('status', ['pending', 'processing']);
  console.log('Payment marked as processing (ACH clearing) for appointment:', appointmentId);
}

/**
 * Handle payment_intent.canceled. With no upfront holds this is now rare (a PaymentIntent canceled
 * out-of-band). T3-13: a still-pending/processing payments row must TERMINALIZE (status 'failed';
 * the payment_status enum has no 'canceled', and payment_intent_status keeps the distinction) or
 * reconcileStuckPayments re-selects it every sweep forever, appending a false drift_repaired row
 * each time. Already-terminal rows just mirror the PI status for the audit trail.
 */
async function handlePaymentIntentCanceled(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  const { error: termError } = await supabase
    .from('payments')
    .update({ status: 'failed', payment_intent_status: 'canceled' })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .in('status', ['pending', 'processing']);
  if (termError) console.error('payment_intent.canceled: failed to terminalize payment record:', termError);

  const { error } = await supabase
    .from('payments')
    .update({ payment_intent_status: 'canceled' })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (error) console.error('payment_intent.canceled: failed to update payment record:', error);
  else console.log('payment_intent.canceled: marked payment canceled for PI', paymentIntent.id);
}

/**
 * Handle refund.failed / refund.updated — sync our refunds ledger to the Stripe refund's
 * terminal status. Essential for the refundable-amount cap, which sums pending+succeeded
 * refunds: a refund that later fails or is canceled must stop counting so it doesn't wrongly
 * block future valid refunds for the payment.
 */
async function handleRefundStatusChange(
  supabase: SupabaseClient,
  refund: Stripe.Refund,
  stripeEventId: string,
) {
  const mapped =
    refund.status === 'succeeded'
      ? 'succeeded'
      : refund.status === 'failed'
        ? 'failed'
        : refund.status === 'canceled'
          ? 'canceled'
          : null;
  if (!mapped) return; // pending / requires_action — nothing terminal to record yet

  const { error } = await supabase
    .from('refunds')
    .update({ status: mapped })
    .eq('stripe_refund_id', refund.id);
  if (error) {
    console.error('refund status change: failed to update refunds row:', error);
    return;
  }

  const payment = await findPaymentByIntent(
    supabase,
    idFromExpandable(refund.payment_intent as string | { id: string } | null),
  );

  // A failed/canceled refund returned NOTHING to the payer (audit H3): if the payment had been
  // marked 'refunded' on the strength of this refund, recompute coverage from the refunds that
  // still count (pending + succeeded — the same math as the refund route's cap) and revert the
  // payment to 'paid' when it is no longer fully covered. Then alert the admins: the customer
  // they believe was refunded still hasn't received the money.
  let revertedToPaid = false;
  if ((mapped === 'failed' || mapped === 'canceled') && payment) {
    if (payment.status === 'refunded') {
      const { data: liveRefunds } = await supabase
        .from('refunds')
        .select('amount')
        .eq('payment_id', payment.id)
        .in('status', ['pending', 'succeeded']);
      const coveredCents = (liveRefunds ?? []).reduce(
        (sum, r) => sum + Number((r as { amount: number }).amount),
        0,
      );
      const grossCents = Math.round(Number(payment.amount) * 100);
      if (coveredCents < grossCents) {
        await supabase
          .from('payments')
          .update({ status: 'paid' })
          .eq('id', payment.id)
          .eq('status', 'refunded');
        revertedToPaid = true;
      }
    }
    if (payment.appointment_id) {
      const ctx = await loadNotificationContext(supabase, {
        appointmentId: payment.appointment_id,
      });
      await recordNotificationEvent(supabase, {
        event_type: 'refund_failed',
        appointment_id: payment.appointment_id,
        organization_id: payment.organization_id,
        dedupe_key: `refund_failed:${refund.id}`,
        payload: { ...ctx, audience: 'admin', amount_cents: refund.amount, refund_id: refund.id },
      });
    }
  }

  await recordPaymentEvent(supabase, {
    paymentId: payment?.id ?? null,
    appointmentId: payment?.appointment_id ?? null,
    organizationId: payment?.organization_id ?? null,
    stripeEventId,
    eventType: `refund_${mapped}`,
    newStatus: mapped,
    actor: 'webhook',
    amount: refund.amount,
    payload: { refund_id: refund.id, stripe_status: refund.status, reverted_to_paid: revertedToPaid },
  });
}

/**
 * Handle setup_intent.succeeded — a homeowner finished a hosted "card link" and saved a
 * card. Close the matching homeowner_payment_links row so the admin UI (which subscribes
 * to it via realtime) reflects "card on file".
 */
async function handleSetupIntentSucceeded(
  supabase: SupabaseClient,
  setupIntent: Stripe.SetupIntent,
) {
  const token = setupIntent.metadata?.token;
  if (!token) {
    console.log('setup_intent.succeeded: no card-link token in metadata, skipping');
    return;
  }

  const { error } = await supabase
    .from('homeowner_payment_links')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      setup_intent_id: setupIntent.id,
    })
    .eq('token', token)
    .eq('status', 'pending');

  if (error) {
    console.error('setup_intent.succeeded: failed to complete card link:', error);
    return;
  }
  console.log('setup_intent.succeeded: card link completed (SI', setupIntent.id, ')');

  // Recovery: the card link is how an admin unsticks a homeowner whose card needed authentication
  // (3-D Secure) or was declined. Now that the homeowner has saved a card on-session (3-D Secure
  // completed, so it's set up for off-session use), re-point their stuck appointments to it and
  // clear the failed state. Under charge-at-completion the failure usually happened AT completion,
  // so COMPLETED jobs are included (they're exactly the ones stuck unpaid) and charged immediately
  // below; only cancelled jobs are excluded. Each re-point also bumps reauth_count: the spent
  // idempotency key `charge-{id}-{attempt}` is cached against the old decline, so without a fresh
  // attempt number the retry would replay the cached failure.
  const pm =
    typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id ?? null;
  const { data: linkRow } = await supabase
    .from('homeowner_payment_links')
    .select('homeowner_id, organization_id')
    .eq('token', token)
    .maybeSingle();
  const link = linkRow as { homeowner_id: string; organization_id: string } | null;
  if (!pm || !link?.homeowner_id || !link.organization_id) return;

  const { data: stuckRows } = await supabase
    .from('appointments')
    .select('id, status, reauth_count')
    .eq('organization_id', link.organization_id)
    .eq('homeowner_id', link.homeowner_id)
    .in('authorization_status', ['requires_action', 'failed'])
    .neq('status', 'cancelled');
  const stuck = (stuckRows ?? []) as Array<{ id: string; status: string; reauth_count: number | null }>;
  if (stuck.length === 0) return;

  for (const row of stuck) {
    await supabase
      .from('appointments')
      .update({
        payment_method_id: pm,
        authorization_status: null,
        reauth_count: (row.reauth_count ?? 0) + 1,
      })
      .eq('id', row.id);
  }
  console.log(
    `setup_intent.succeeded: re-pointed ${stuck.length} stuck appointment(s) to the new card`,
  );

  // A completed job is owed money NOW — charge the new card immediately (idempotent via the
  // paid/processing guard). Failures fall to the chargeUncollectedCompletions sweep / the
  // failed-state pill, never out of this handler.
  for (const row of stuck) {
    if (row.status !== 'completed') continue;
    try {
      const outcome = await chargeCompletedAppointmentAuto(
        supabase,
        row.id,
        'webhook:setup_intent.succeeded',
      );
      console.log(`setup_intent.succeeded: charged completed appointment ${row.id}:`, outcome.code);
    } catch (err) {
      console.error(`setup_intent.succeeded: charge for ${row.id} threw:`, err);
    }
  }
}

/**
 * Handle setup_intent.setup_failed — a homeowner's card-link save attempt failed. The SetupIntent
 * can still be retried on the same hosted link, so we deliberately do NOT expire the link (that
 * would kill a usable link). Record a forensic event so the failure isn't silently dropped.
 */
async function handleSetupIntentSetupFailed(supabase: SupabaseClient, setupIntent: Stripe.SetupIntent) {
  const token = setupIntent.metadata?.token;
  let orgId: string | null = null;
  if (token) {
    const { data: link } = await supabase
      .from('homeowner_payment_links')
      .select('organization_id')
      .eq('token', token)
      .maybeSingle();
    orgId = (link as { organization_id: string } | null)?.organization_id ?? null;
  }
  await recordPaymentEvent(supabase, {
    organizationId: orgId,
    eventType: 'setup_intent_failed',
    actor: 'webhook',
    payload: {
      setup_intent_id: setupIntent.id,
      token: token ?? null,
      error: setupIntent.last_setup_error?.message ?? null,
    },
  });
  console.log('setup_intent.setup_failed recorded (card link stays pending, retryable):', setupIntent.id);
}

/**
 * Handle charge.refunded — confirms a refund settled at Stripe. Mark our pending `refunds`
 * rows succeeded (match by stripe_refund_id), and if the charge is now fully refunded,
 * ensure the payment reads 'refunded'. The refund route already did the optimistic writes;
 * this is the authoritative confirmation.
 */
async function handleChargeRefunded(
  supabase: SupabaseClient,
  charge: Stripe.Charge,
  stripeEventId: string,
) {
  const refundList = charge.refunds?.data ?? [];
  for (const r of refundList) {
    await supabase
      .from('refunds')
      .update({ status: 'succeeded' })
      .eq('stripe_refund_id', r.id)
      .eq('status', 'pending');
  }

  const piId = idFromExpandable(charge.payment_intent);
  const payment = await findPaymentByIntent(supabase, piId);
  const fullyRefunded = charge.amount_refunded >= charge.amount;

  if (payment && fullyRefunded && payment.status !== 'refunded') {
    await supabase.from('payments').update({ status: 'refunded' }).eq('id', payment.id);
  }

  // Claw back the cleaner (and tenant) transfers proportionally for an OUT-OF-BAND refund (e.g.
  // issued directly in the Stripe Dashboard). The in-app refund route already unwinds them and
  // marks the payout reversed; this is idempotent (cumulative amount_reversed math), so it's a
  // no-op there and only does real work for a refund the app didn't originate.
  if (payment) {
    await reverseJobTransfersForRefund(supabase, {
      appointmentId: payment.appointment_id,
      totalRefundedCents: charge.amount_refunded,
      grossCents: charge.amount,
      actor: 'webhook',
      stripeEventId,
      paymentId: payment.id,
      organizationId: payment.organization_id,
      sourceChargeId: charge.id,
    });
  }

  await recordPaymentEvent(supabase, {
    paymentId: payment?.id ?? null,
    appointmentId: payment?.appointment_id ?? null,
    organizationId: payment?.organization_id ?? null,
    stripeEventId,
    eventType: 'charge_refunded',
    newStatus: fullyRefunded ? 'refunded' : payment?.status ?? null,
    actor: 'webhook',
    amount: charge.amount_refunded,
    payload: { charge_id: charge.id, fully_refunded: fullyRefunded },
  });
}

/**
 * Handle charge.failed — belt-and-suspenders for an ACH (us_bank_account) debit that returns after
 * the PaymentIntent already succeeded and settled. payment_intent.payment_failed covers the common
 * case; this is the charge-level signal. Claw back the cleaner payout if one was paid (idempotent).
 */
async function handleChargeFailed(supabase: SupabaseClient, charge: Stripe.Charge) {
  const piId = idFromExpandable(charge.payment_intent);
  const payment = await findPaymentByIntent(supabase, piId);
  if (!payment) return;
  await clawbackCleanerPayout(supabase, {
    appointmentId: payment.appointment_id,
    actor: 'webhook',
    reason: 'ach_return',
    paymentId: payment.id,
    organizationId: payment.organization_id,
  });
}

/**
 * Handle charge.dispute.created — the homeowner disputed a charge. Record the dispute
 * against the owning tenant (merchant of record) so it surfaces in the ops view; Stripe has
 * already debited the disputed funds + fee from the tenant balance.
 */
async function handleChargeDisputeCreated(
  supabase: SupabaseClient,
  dispute: Stripe.Dispute,
  stripeEventId: string,
) {
  const piId = idFromExpandable(dispute.payment_intent);
  const chargeId = idFromExpandable(dispute.charge) ?? '';
  const payment = await findPaymentByIntent(supabase, piId);

  if (!payment) {
    // No matching payment (a dispute on a charge we can't map, or a rare race where the dispute
    // arrives before our payment row exists). Don't silently drop it: record a forensic event so
    // it's auditable / surfaceable for manual review instead of vanishing into a log line.
    console.warn('charge.dispute.created: no matching payment for dispute', dispute.id, '(recorded as unmatched_dispute)');
    await recordPaymentEvent(supabase, {
      stripeEventId,
      eventType: 'unmatched_dispute',
      actor: 'webhook',
      amount: dispute.amount,
      payload: { dispute_id: dispute.id, charge_id: chargeId, payment_intent: piId, reason: dispute.reason ?? null },
    });
    return;
  }

  const evidenceDueBy = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
    : null;

  const { error } = await supabase.from('disputes').upsert(
    {
      organization_id: payment.organization_id,
      payment_id: payment.id,
      stripe_dispute_id: dispute.id,
      stripe_charge_id: chargeId,
      amount: dispute.amount,
      status: dispute.status,
      reason: dispute.reason ?? null,
      evidence_due_by: evidenceDueBy,
    },
    { onConflict: 'stripe_dispute_id' },
  );
  if (error) console.error('charge.dispute.created: failed to record dispute:', error);

  await recordPaymentEvent(supabase, {
    paymentId: payment.id,
    appointmentId: payment.appointment_id,
    organizationId: payment.organization_id,
    stripeEventId,
    eventType: 'dispute_created',
    actor: 'webhook',
    amount: dispute.amount,
    payload: { dispute_id: dispute.id, reason: dispute.reason, evidence_due_by: evidenceDueBy },
  });

  // Alert the tenant admins in-app, with the evidence due-by date.
  if (payment.appointment_id) {
    const ctx = await loadNotificationContext(supabase, {
      appointmentId: payment.appointment_id,
    });
    await recordNotificationEvent(supabase, {
      event_type: 'dispute_opened',
      appointment_id: payment.appointment_id,
      organization_id: payment.organization_id,
      payload: {
        ...ctx,
        audience: 'admin',
        amount_cents: dispute.amount,
        evidence_due_by: evidenceDueBy ?? undefined,
      },
    });
  }
}

/**
 * Handle charge.dispute.closed — if the dispute was LOST and we'd already paid the cleaner,
 * claw back the cleaner's share via transfer reversal (decision #12). The tenant absorbs the
 * remainder + the dispute fee (Stripe already debited those from the tenant balance).
 */
async function handleChargeDisputeClosed(
  supabase: SupabaseClient,
  dispute: Stripe.Dispute,
  stripeEventId: string,
) {
  await supabase
    .from('disputes')
    .update({ status: dispute.status })
    .eq('stripe_dispute_id', dispute.id);

  const piId = idFromExpandable(dispute.payment_intent);
  const payment = await findPaymentByIntent(supabase, piId);

  if (dispute.status !== 'lost') {
    await recordPaymentEvent(supabase, {
      paymentId: payment?.id ?? null,
      appointmentId: payment?.appointment_id ?? null,
      organizationId: payment?.organization_id ?? null,
      stripeEventId,
      eventType: 'dispute_closed',
      newStatus: dispute.status,
      actor: 'webhook',
      payload: { dispute_id: dispute.id, outcome: dispute.status },
    });
    return;
  }

  // Dispute LOST — claw back the cleaner's transfer if one was paid (the tenant absorbs the
  // remainder + the dispute fee, decision #12). The helper is idempotent, records its own
  // dispute_lost_clawback / cleaner_clawback_failed ledger event, and never throws.
  if (payment) {
    await clawbackCleanerPayout(supabase, {
      appointmentId: payment.appointment_id,
      actor: 'webhook',
      reason: 'dispute_lost',
      stripeEventId,
      paymentId: payment.id,
      organizationId: payment.organization_id,
    });
  }

  await recordPaymentEvent(supabase, {
    paymentId: payment?.id ?? null,
    appointmentId: payment?.appointment_id ?? null,
    organizationId: payment?.organization_id ?? null,
    stripeEventId,
    eventType: 'dispute_lost',
    newStatus: 'lost',
    actor: 'webhook',
    amount: dispute.amount,
    payload: { dispute_id: dispute.id },
  });
}

/**
 * Handle radar.early_fraud_warning.created — Stripe's network flagged a likely-fraudulent card
 * charge BEFORE a formal dispute, the window to proactively refund and dodge the chargeback + fee.
 * Record it to the forensic ledger so it's auditable (surfacing it in the UI is a follow-up).
 */
async function handleEarlyFraudWarning(
  supabase: SupabaseClient,
  efw: Stripe.Radar.EarlyFraudWarning,
  stripeEventId: string,
) {
  const payment = await findPaymentByIntent(supabase, idFromExpandable(efw.payment_intent));
  await recordPaymentEvent(supabase, {
    paymentId: payment?.id ?? null,
    appointmentId: payment?.appointment_id ?? null,
    organizationId: payment?.organization_id ?? null,
    stripeEventId,
    eventType: 'early_fraud_warning',
    actor: 'webhook',
    payload: { efw_id: efw.id, charge_id: idFromExpandable(efw.charge), fraud_type: efw.fraud_type },
  });
}

/**
 * Handle review.opened / review.closed — Stripe Radar placed a charge under manual review (or
 * closed one). Record it so a held/under-review charge is visible in the forensic ledger.
 */
async function handleReview(
  supabase: SupabaseClient,
  review: Stripe.Review,
  stripeEventId: string,
  eventType: string,
) {
  const payment = await findPaymentByIntent(supabase, idFromExpandable(review.payment_intent));
  await recordPaymentEvent(supabase, {
    paymentId: payment?.id ?? null,
    appointmentId: payment?.appointment_id ?? null,
    organizationId: payment?.organization_id ?? null,
    stripeEventId,
    eventType: eventType === 'review.closed' ? 'radar_review_closed' : 'radar_review_opened',
    actor: 'webhook',
    payload: { review_id: review.id, reason: review.reason ?? null, closed_reason: review.closed_reason ?? null },
  });
}

/**
 * Handle application_fee.refunded — mirror the refunded amount onto our application_fees
 * ledger (relevant only once platform_fee_bps > 0; today fees are 0 so this is a no-op).
 */
async function handleApplicationFeeRefunded(
  supabase: SupabaseClient,
  fee: Stripe.ApplicationFee,
) {
  const { error } = await supabase
    .from('application_fees')
    .update({ refunded_amount: fee.amount_refunded })
    .eq('stripe_application_fee_id', fee.id);
  if (error) console.error('application_fee.refunded: failed to update ledger:', error);
}

async function handleTransferReversed(supabase: SupabaseClient, transfer: Stripe.Transfer) {
  console.log('Transfer reversed:', transfer.id, `(${transfer.amount_reversed ?? 0}/${transfer.amount})`);

  const { data: existingPayout, error: findError } = await supabase
    .from('payouts')
    .select('id, status, appointment_id, organization_id')
    .eq('stripe_transfer_id', transfer.id)
    .single();

  if (findError || !existingPayout) {
    console.log('No payout record found for reversed transfer:', transfer.id);
    return;
  }
  const payout = existingPayout as {
    id: string;
    status: string;
    appointment_id: string | null;
    organization_id: string | null;
  };

  // T3-12: transfer.reversed also fires for PARTIAL reversals (our own partial-refund unwind
  // reverses proportionally), and terminalizing the payout on one would silently block a later
  // full clawback of the remaining cut. Mirror clawback's semantics: only a fully-reversed
  // transfer retires the row to 'reversed'; a partial stamps reversed_at, appends a forensic
  // ledger event, and keeps the status.
  const fullyReversed = transfer.reversed === true || (transfer.amount_reversed ?? 0) >= transfer.amount;
  if (!fullyReversed) {
    const { error: partialError } = await supabase
      .from('payouts')
      .update({ reversed_at: new Date().toISOString() })
      .eq('id', payout.id);
    if (partialError) console.error('transfer.reversed: failed to stamp partial reversal:', partialError);
    await recordPaymentEvent(supabase, {
      appointmentId: payout.appointment_id,
      organizationId: payout.organization_id,
      eventType: 'transfer_partially_reversed',
      actor: 'webhook',
      amount: transfer.amount_reversed ?? 0,
      payload: {
        transfer_id: transfer.id,
        amount: transfer.amount,
        amount_reversed: transfer.amount_reversed ?? 0,
        payout_status: payout.status,
      },
    });
    console.log(`transfer.reversed ${transfer.id}: partial, payout ${payout.id} keeps status '${payout.status}'`);
    return;
  }

  const { error: updateError } = await supabase
    .from('payouts')
    .update({ status: 'reversed', reversed_at: new Date().toISOString() })
    .eq('id', payout.id);

  if (updateError) console.error('Error marking payout as reversed:', updateError);
  else console.log('Payout marked as reversed for transfer:', transfer.id);
}

/**
 * Fallback when a payout.paid event can't be tied to specific transfer ids: mark only the
 * SINGLE oldest still-unattributed payout for the cleaner, never the whole set. Stamping every
 * `stripe_payout_id IS NULL` row with this payout's id would claim unrelated payouts and cause
 * wrong reversions on a later payout.failed. Under-marking is self-healing — the precise
 * transfer-id path or the reconcile sweep settles the rest.
 */
async function markOldestUnattributedPayout(
  supabase: SupabaseClient,
  cleanerId: string,
  bankPaidUpdate: { status: 'bank_paid'; stripe_payout_id: string; bank_paid_at: string },
): Promise<number> {
  const { data: candidate } = await supabase
    .from('payouts')
    .select('id')
    .eq('cleaner_id', cleanerId)
    .eq('status', 'paid')
    .is('stripe_payout_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return 0;
  // Re-assert status='paid' so a concurrent executor (live delivery vs the bank-paid sweep
  // replaying the same payout) that already stamped or reverted this row wins the race.
  const { data: updated, error } = await supabase
    .from('payouts')
    .update(bankPaidUpdate)
    .eq('id', (candidate as { id: string }).id)
    .eq('status', 'paid')
    .select('id');
  if (error) {
    console.error('payout.paid: DB error during narrowed fallback update:', error);
    return 0;
  }
  return (updated ?? []).length;
}

/**
 * Handle payout.paid from a connected account — money landed in the cleaner's bank.
 * Connect events arrive with event.account set to the connected account ID.
 */
async function handlePayoutPaid(
  supabase: SupabaseClient,
  payout: Stripe.Payout,
  connectedAccountId: string | null,
) {
  const arrivalDate = new Date(payout.arrival_date * 1000).toISOString();

  console.log('Payout paid webhook received:', { payoutId: payout.id, connectedAccountId, arrivalDate });

  if (!connectedAccountId) {
    console.warn('payout.paid event missing event.account — Connect webhook not configured. Will be caught by reconcile.', { payoutId: payout.id });
    return;
  }

  const { data: cleaner, error: cleanerError } = await supabase
    .from('cleaner_profiles')
    .select('id')
    .eq('stripe_connect_account_id', connectedAccountId)
    .single();

  if (cleanerError || !cleaner) {
    console.log('No cleaner found for connected account:', connectedAccountId, cleanerError?.message);
    return;
  }

  // Idempotent-replay guard: a payout.paid can be re-delivered (Stripe retries a 500) or replayed by
  // the dead-letter sweep (T1-10). If THIS payout already settled rows for this cleaner, the precise
  // update below would match 0 rows (they are 'bank_paid' now, not 'paid') and fall through to
  // markOldestUnattributedPayout, mis-stamping an UNRELATED payout. Detect the prior settlement and
  // no-op instead of mis-attributing.
  const { data: alreadySettled } = await supabase
    .from('payouts')
    .select('id')
    .eq('cleaner_id', cleaner.id)
    .eq('stripe_payout_id', payout.id)
    .eq('status', 'bank_paid')
    .limit(1);
  if (alreadySettled && alreadySettled.length > 0) {
    console.log(`payout.paid ${payout.id}: already settled for cleaner ${cleaner.id} — idempotent replay, skipping`);
    return;
  }

  let transferIds: string[] = [];
  try {
    const { getPayoutTransferIds } = await import('@/lib/stripe');
    transferIds = await getPayoutTransferIds(connectedAccountId, payout.id);
    console.log(`payout.paid ${payout.id}: resolved ${transferIds.length} transfer(s)`);
  } catch (err) {
    // A resolution ERROR is not knowledge: falling back here used to stamp the oldest
    // unattributed row with an arbitrary payout id, and the bank-paid sweep multiplies
    // executions of this path (one transient Stripe 5xx per sweep would eventually
    // mis-stamp). Leave the rows for the next delivery / sweep cycle instead.
    console.warn('payout.paid: could not fetch balance transactions; leaving rows for retry:', err);
    return;
  }

  const bankPaidUpdate = {
    status: 'bank_paid' as const,
    stripe_payout_id: payout.id,
    bank_paid_at: arrivalDate,
  };

  let count = 0;

  if (transferIds.length > 0) {
    const { data: updatedRows, error: updateError } = await supabase
      .from('payouts')
      .update(bankPaidUpdate)
      .eq('cleaner_id', cleaner.id)
      .eq('status', 'paid')
      .in('stripe_transfer_id', transferIds)
      .select('id');

    // T3-15: when the transfer ids DID resolve, zero matches (or a DB error) means this payout
    // covers nothing we still track as owed. Guessing via the oldest-unattributed fallback here
    // could stamp the WRONG row, which a later payout.failed for this payout would then wrongly
    // revert. The fallback is reserved for the branch where transfer ids could not be resolved.
    if (updateError) console.error('payout.paid: DB error during precise update:', updateError);
    else count = (updatedRows ?? []).length;
    if (count === 0) {
      console.log(`payout.paid ${payout.id}: resolved transfers matched no local 'paid' rows; skipping fallback`);
    }
  } else {
    count = await markOldestUnattributedPayout(supabase, cleaner.id, bankPaidUpdate);
  }

  if (count === 0) {
    console.warn('payout.paid: no eligible payout rows updated for cleaner:', cleaner.id, 'payout:', payout.id);
  } else {
    console.log(`payout.paid: marked ${count} row(s) as bank_paid for cleaner ${cleaner.id}`);
    await notifyCleanerPaid(supabase, cleaner.id, payout.id);
  }
}

/**
 * Emit a `cleaner_paid` in-app notification for each payout row this Stripe
 * payout just settled to the cleaner's bank. Best-effort; runs after the rows
 * are marked bank_paid (every settled row carries this payout's stripe_payout_id).
 */
async function notifyCleanerPaid(
  supabase: SupabaseClient,
  cleanerId: string,
  payoutId: string,
): Promise<void> {
  const { data: rows } = await supabase
    .from('payouts')
    .select('appointment_id, amount, organization_id')
    .eq('cleaner_id', cleanerId)
    .eq('stripe_payout_id', payoutId)
    .eq('status', 'bank_paid');
  for (const r of (rows ?? []) as Array<{
    appointment_id: string | null;
    amount: number | string | null;
    organization_id: string | null;
  }>) {
    if (!r.appointment_id || !r.organization_id) continue;
    const ctx = await loadNotificationContext(supabase, { appointmentId: r.appointment_id });
    await recordNotificationEvent(supabase, {
      event_type: 'cleaner_paid',
      appointment_id: r.appointment_id,
      organization_id: r.organization_id,
      recipient_user_id: cleanerId,
      // The bank-paid sweep is a second concurrent invoker of handlePayoutPaid (besides live
      // delivery + its retries), so this write must be idempotent per payout+job.
      dedupe_key: `cleaner_paid:${payoutId}:${r.appointment_id}`,
      payload: {
        ...ctx,
        audience: 'cleaner',
        amount_cents: Math.round(Number(r.amount ?? 0) * 100),
      },
    });
  }
}

async function handlePayoutFailed(
  supabase: SupabaseClient,
  payout: Stripe.Payout,
  connectedAccountId: string | null,
) {
  console.log('Payout failed webhook received:', { payoutId: payout.id, connectedAccountId, failureCode: payout.failure_code });

  if (!connectedAccountId) {
    console.warn('payout.failed event missing event.account — Connect webhook not configured.');
    return;
  }

  const { data: cleaner, error: cleanerError } = await supabase
    .from('cleaner_profiles')
    .select('id, organization_id')
    .eq('stripe_connect_account_id', connectedAccountId)
    .single();

  if (cleanerError || !cleaner) {
    console.log('No cleaner found for connected account on payout.failed:', connectedAccountId);
    return;
  }

  // Only bank_paid rows revert: a row this payout once stamped that was since fully clawed
  // back ('reversed') must NOT be resurrected to 'paid' (retryFailedPayouts would re-pay it).
  const { data: revertedRows, error: updateError } = await supabase
    .from('payouts')
    .update({ status: 'paid', stripe_payout_id: null, bank_paid_at: null })
    .eq('cleaner_id', cleaner.id)
    .eq('stripe_payout_id', payout.id)
    .eq('status', 'bank_paid')
    .select('id, appointment_id, organization_id, amount');

  if (updateError) console.error('Error reverting payouts after payout.failed:', updateError);
  const reverted = (revertedRows ?? []) as Array<{
    id: string;
    appointment_id: string | null;
    organization_id: string | null;
    amount: number | string | null;
  }>;
  console.log(`payout.failed: reverted ${reverted.length} row(s) for cleaner ${cleaner.id}`);

  // T3-14: a bank-level payout failure used to be a silent revert — the cleaner with a closed
  // bank account was told nothing and the org never knew payment was bouncing. Ledger each
  // reverted row (org-scoped; alertable via paymentEventAlerts) and notify both sides, deduped
  // by payout id. Gated on reverted > 0: the bank-paid sweep replays every terminal payout in
  // its lookback, and a failure that reverted nothing we track (long-resolved history, or a
  // re-delivery after the revert) must stay silent rather than alarm the cleaner about money
  // that was re-paid weeks ago.
  if (reverted.length === 0) {
    console.log(`payout.failed ${payout.id}: no bank_paid rows to revert; staying silent`);
    return;
  }
  for (const r of reverted) {
    await recordPaymentEvent(supabase, {
      appointmentId: r.appointment_id,
      organizationId: r.organization_id,
      eventType: 'cleaner_payout_bank_failed',
      prevStatus: 'bank_paid',
      newStatus: 'paid',
      actor: 'webhook',
      amount: Math.round(Number(r.amount ?? 0) * 100),
      payload: {
        payout_id: payout.id,
        failure_code: payout.failure_code ?? null,
        failure_message: payout.failure_message ?? null,
      },
    });
  }
  await notifyPayoutBankFailed(supabase, {
    cleanerId: (cleaner as { id: string }).id,
    organizationId:
      reverted[0]?.organization_id ??
      ((cleaner as { organization_id?: string | null }).organization_id ?? null),
    payout,
    revertedCount: reverted.length,
  });
}

/**
 * Notify the cleaner (their bank details need fixing) and the org admins after a bank-level
 * payout failure (T3-14). Payout-level rather than per-appointment (one payout batches many
 * jobs), deduped by payout id. Best-effort like every notification write.
 */
async function notifyPayoutBankFailed(
  supabase: SupabaseClient,
  p: {
    cleanerId: string;
    organizationId: string | null;
    payout: Stripe.Payout;
    revertedCount: number;
  },
): Promise<void> {
  if (!p.organizationId) {
    console.warn('payout.failed: no organization resolved for cleaner, skipping notifications:', p.cleanerId);
    return;
  }
  let cleanerName: string | undefined;
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('id', p.cleanerId)
      .maybeSingle();
    if (profile) {
      const name = formatUserName(
        (profile as { first_name: string | null }).first_name,
        (profile as { last_name: string | null }).last_name,
      );
      if (name) cleanerName = name;
    }
  } catch {
    // name is cosmetic; the label falls back to generic copy
  }
  const base = {
    amount_cents: p.payout.amount,
    failure_code: p.payout.failure_code ?? null,
    reverted_count: p.revertedCount,
  };
  await recordNotificationEvent(supabase, {
    event_type: 'cleaner_payout_bank_failed',
    organization_id: p.organizationId,
    recipient_user_id: p.cleanerId,
    dedupe_key: `payout_bank_failed:${p.payout.id}`,
    payload: { ...base, audience: 'cleaner' },
  });
  await recordNotificationEvent(supabase, {
    event_type: 'cleaner_payout_bank_failed',
    organization_id: p.organizationId,
    dedupe_key: `payout_bank_failed:${p.payout.id}`,
    payload: { ...base, audience: 'admin', cleaner_name: cleanerName },
  });
}

/**
 * Handle account.updated — mirror a connected account's capability + requirements state
 * into our DB (tenant organization OR cleaner, resolved by stripe_connect_account_id).
 */
async function handleAccountUpdated(supabase: SupabaseClient, account: Stripe.Account) {
  const acctId = account.id;
  const chargesEnabled = account.charges_enabled ?? false;
  const payoutsEnabled = account.payouts_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;
  const requirementsDue = account.requirements?.currently_due ?? [];

  const { data: org } = await supabase
    .from('organizations')
    .select('id, stripe_connect_onboarded_at')
    .eq('stripe_connect_account_id', acctId)
    .maybeSingle();

  if (org) {
    const update: Record<string, unknown> = {
      stripe_connect_charges_enabled: chargesEnabled,
      stripe_connect_payouts_enabled: payoutsEnabled,
      stripe_connect_details_submitted: detailsSubmitted,
      stripe_connect_requirements_due: requirementsDue,
    };
    if (detailsSubmitted && !(org as { stripe_connect_onboarded_at: string | null }).stripe_connect_onboarded_at) {
      update.stripe_connect_onboarded_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from('organizations')
      .update(update)
      .eq('id', (org as { id: string }).id);
    if (error) console.error('account.updated: failed to mirror tenant org state:', error);
    else console.log('account.updated: mirrored tenant org state for', acctId);
    return;
  }

  const { data: cleaner } = await supabase
    .from('cleaner_profiles')
    .select('id')
    .eq('stripe_connect_account_id', acctId)
    .maybeSingle();

  if (cleaner) {
    const { error } = await supabase
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: detailsSubmitted && payoutsEnabled })
      .eq('id', (cleaner as { id: string }).id);
    if (error) console.error('account.updated: failed to mirror cleaner state:', error);
    else console.log('account.updated: mirrored cleaner state for', acctId);
    return;
  }

  // Fallback: stored-ID lookup missed. If this account carries metadata.organization_id
  // identifying a known org with a DIFFERENT stored id, we're seeing drift (incident
  // 2026-05-28: "use existing Stripe account" can land onboarding on an acct we never
  // saved). Record to connect_account_drift_events for the platform admin to reconcile —
  // do NOT auto-rewrite the stored id.
  const metaOrgId = account.metadata?.organization_id;
  if (metaOrgId) {
    const { data: metaOrg } = await supabase
      .from('organizations')
      .select('id, stripe_connect_account_id')
      .eq('id', metaOrgId)
      .maybeSingle();
    if (metaOrg) {
      const expected = (metaOrg as { stripe_connect_account_id: string | null }).stripe_connect_account_id;
      if (expected !== acctId) {
        const { data: alreadyOpen } = await supabase
          .from('connect_account_drift_events')
          .select('id')
          .eq('organization_id', metaOrgId)
          .eq('observed_account_id', acctId)
          .is('resolved_at', null)
          .maybeSingle();
        if (!alreadyOpen) {
          const { error: driftErr } = await supabase.from('connect_account_drift_events').insert({
            organization_id: metaOrgId,
            cleaner_id: null,
            expected_account_id: expected,
            observed_account_id: acctId,
            source: 'webhook',
            metadata: {
              charges_enabled: chargesEnabled,
              payouts_enabled: payoutsEnabled,
              details_submitted: detailsSubmitted,
              account_metadata: account.metadata ?? {},
            },
          });
          if (driftErr) {
            console.error('account.updated: failed to record drift event:', driftErr);
          } else {
            console.warn(
              'account.updated: recorded drift event for org',
              metaOrgId,
              'expected',
              expected,
              'observed',
              acctId,
            );
          }
        }
        return;
      }
    }
  }

  console.log('account.updated: no matching org or cleaner for account', acctId);
}

// ── SaaS subscription billing (Scenario 3, Phase 5) ──────────────────────────────

/** Resolve the owning org for a subscription: metadata first, then the billing Customer id. */
async function resolveOrgForSubscription(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const metaOrg = sub.metadata?.organization_id;
  if (metaOrg) return metaOrg;
  const customerId = idFromExpandable(sub.customer as string | { id: string } | null);
  if (!customerId) return null;
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Append a subscription/invoice event to the audit table (idempotent on stripe_event_id). */
async function recordSubscriptionEvent(
  supabase: SupabaseClient,
  organizationId: string,
  stripeEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from('tenant_subscription_events').upsert(
    { organization_id: organizationId, stripe_event_id: stripeEventId, event_type: eventType, payload },
    { onConflict: 'stripe_event_id', ignoreDuplicates: true },
  );
  if (error) console.error('recordSubscriptionEvent: failed to audit subscription event:', error);
}

async function handleSubscriptionUpsert(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
  stripeEventId: string,
  eventType: string,
) {
  const orgId = await resolveOrgForSubscription(supabase, sub);
  if (!orgId) {
    console.warn(`${eventType}: no matching org for subscription ${sub.id} — skipping`);
    return;
  }
  // current_period_end has moved across Stripe API versions; read it defensively.
  const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
  await supabase
    .from('organizations')
    .update({
      subscription_id: sub.id,
      subscription_status: mapSubscriptionStatus(sub.status),
      subscription_current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
    })
    .eq('id', orgId);
  await recordSubscriptionEvent(supabase, orgId, stripeEventId, eventType, {
    subscription_id: sub.id,
    stripe_status: sub.status,
  });
}

async function handleSubscriptionDeleted(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
  stripeEventId: string,
) {
  const orgId = await resolveOrgForSubscription(supabase, sub);
  if (!orgId) return;
  await supabase.from('organizations').update({ subscription_status: 'canceled' }).eq('id', orgId);
  await recordSubscriptionEvent(supabase, orgId, stripeEventId, 'customer.subscription.deleted', {
    subscription_id: sub.id,
  });
}

async function handleInvoiceEvent(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
  stripeEventId: string,
  eventType: string,
) {
  const customerId = idFromExpandable(invoice.customer as string | { id: string } | null);
  if (!customerId) return;
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  const orgId = (data as { id: string } | null)?.id;
  if (!orgId) return;
  await recordSubscriptionEvent(supabase, orgId, stripeEventId, eventType, {
    invoice_id: invoice.id,
    invoice_status: invoice.status,
    amount_paid: invoice.amount_paid,
    amount_due: invoice.amount_due,
  });
  // invoice.payment_failed degrading tenant access (subscription_status already mirrored by the
  // customer.subscription.updated event) is deferred — see plan Phase 5 / open question.
}
