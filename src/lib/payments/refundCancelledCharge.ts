/**
 * Auto-refund a job debit that settled AFTER its appointment was cancelled.
 *
 * The case: an ACH debit (or a completion charge racing a cancel) is in flight when the
 * appointment is cancelled. Stripe can't cancel a processing debit, so it settles days later;
 * without this, the payer is charged for a cancelled job and the funds strand on the platform
 * balance (settlement skips the cleaner but the tenant leg would still pay out).
 *
 * Policy: a cancelled job's COMPLETION charge is always refunded in full. The CANCELLATION FEE
 * charge legitimately succeeds on a cancelled appointment and settles to the tenant — callers
 * route on `charge_kind` and never send a fee charge here. ACH payers are exempt from
 * cancellation fees by existing policy, so there is no fee carve-out to compute.
 *
 * The payment row deliberately stays 'paid' until the charge.refunded webhook CONFIRMS the
 * refund (handleChargeRefunded flips it to 'refunded'): marking it refunded at create time would
 * take the row out of the settleUnsettledCaptures backstop, so a refund that Stripe later fails
 * (refund.updated -> failed) would never be retried while the customer stays charged. Instead:
 *   - an in-flight ('pending') or confirmed refund short-circuits re-entry (webhook replays and
 *     sweep passes are cheap no-ops);
 *   - a FAILED refund increments the attempt counter, so the retry gets a FRESH idempotency key
 *     (`cancelrefund-{id}-{n}`) instead of replaying the failed refund object forever.
 * Never throws into the webhook; a failed create records a ledger event and the sweep retries.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRefund } from '@/lib/stripe/charges/refund';
import { recordPaymentEvent } from './events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { notifyHomeownerRefundIssued } from './homeownerMoneyEvents';

export interface CancelledRefundResult {
  refunded: boolean;
  reason?: string;
}

export async function refundCancelledInflightCharge(
  supabase: SupabaseClient,
  p: {
    appointmentId: string;
    paymentIntentId: string;
    actor: string;
  },
): Promise<CancelledRefundResult> {
  const { data: payRow } = await supabase
    .from('payments')
    .select('id, organization_id, appointment_id, amount, status')
    .eq('stripe_payment_intent_id', p.paymentIntentId)
    .maybeSingle();
  const payment = payRow as
    | { id: string; organization_id: string; appointment_id: string; amount: number | string; status: string }
    | null;
  if (!payment) return { refunded: false, reason: 'no_payment_row' };
  if (payment.status === 'refunded') return { refunded: true, reason: 'already_refunded' };

  // Prior refund attempts for this debit: an in-flight/confirmed one means we're just waiting on
  // the charge.refunded webhook; failed ones advance the idempotency-key attempt counter.
  const { data: priorRows } = await supabase
    .from('refunds')
    .select('status')
    .eq('payment_id', payment.id)
    .eq('reason', 'cancelled_inflight_debit');
  const prior = (priorRows ?? []) as Array<{ status: string }>;
  if (prior.some((r) => r.status === 'pending' || r.status === 'succeeded')) {
    return { refunded: true, reason: 'refund_in_flight' };
  }
  const attempt = prior.length;

  const amountCents = Math.round(Number(payment.amount) * 100);

  let refund;
  try {
    refund = await createRefund({
      paymentIntentId: p.paymentIntentId,
      // No amount: full refund of whatever settled.
      reason: 'requested_by_customer',
      metadata: { appointment_id: p.appointmentId, cancelled_inflight: 'true' },
      idempotencyKey: `cancelrefund-${p.appointmentId}-${attempt}`,
    });
  } catch (err) {
    await recordPaymentEvent(supabase, {
      paymentId: payment.id,
      appointmentId: p.appointmentId,
      organizationId: payment.organization_id,
      eventType: 'cancelled_inflight_refund_failed',
      actor: p.actor,
      amount: amountCents,
      payload: { error: err instanceof Error ? err.message : String(err), attempt },
    });
    return { refunded: false, reason: 'refund_failed' };
  }

  // initiator_user_id is null: this refund is system-issued (migration 088 relaxed the column).
  // The reason value is what re-entry filters on above. 23505 = the webhook raced us; benign.
  const { error: refundInsertError } = await supabase.from('refunds').insert({
    organization_id: payment.organization_id,
    payment_id: payment.id,
    appointment_id: p.appointmentId,
    stripe_refund_id: refund.id,
    amount: amountCents,
    reason: 'cancelled_inflight_debit',
    status: 'pending',
  });
  if (refundInsertError && refundInsertError.code !== '23505') {
    // The refund EXISTS at Stripe; flag the ledger gap loudly, don't fail the handler.
    console.error('cancelled-inflight refund row insert failed:', refundInsertError.message);
  }

  await recordPaymentEvent(supabase, {
    paymentId: payment.id,
    appointmentId: p.appointmentId,
    organizationId: payment.organization_id,
    eventType: 'cancelled_inflight_refunded',
    prevStatus: payment.status,
    newStatus: 'refund_pending',
    actor: p.actor,
    amount: amountCents,
    payload: { refund_id: refund.id, payment_intent_id: p.paymentIntentId, attempt },
  });

  const ctx = await loadNotificationContext(supabase, { appointmentId: p.appointmentId });
  await recordNotificationEvent(supabase, {
    event_type: 'cancelled_job_refunded',
    appointment_id: p.appointmentId,
    organization_id: payment.organization_id,
    dedupe_key: `cancelled_job_refunded:${p.appointmentId}`,
    payload: { ...ctx, audience: 'admin', amount_cents: amountCents, refund_id: refund.id },
  });

  // T2-1: the payer's own copy. Keyed on the Stripe refund id, so a retry that creates a NEW
  // refund object (fresh attempt counter) correctly notifies again, while a replay of this one
  // does not.
  await notifyHomeownerRefundIssued(supabase, {
    appointmentId: p.appointmentId,
    organizationId: payment.organization_id,
    refundId: refund.id,
    amountCents,
  });

  return { refunded: true };
}
