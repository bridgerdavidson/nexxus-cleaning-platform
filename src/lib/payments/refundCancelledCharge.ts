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
 * Idempotent: the Stripe refund uses key `cancelrefund-{appointmentId}`, and a payment row
 * already 'refunded' short-circuits. Never throws into the webhook; a failed refund records a
 * ledger event and the reconcile backstop (settleUnsettledCaptures routes cancelled completion
 * rows back here) retries it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRefund } from '@/lib/stripe/charges/refund';
import { recordPaymentEvent } from './events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

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

  const amountCents = Math.round(Number(payment.amount) * 100);

  let refund;
  try {
    refund = await createRefund({
      paymentIntentId: p.paymentIntentId,
      // No amount: full refund of whatever settled.
      reason: 'requested_by_customer',
      metadata: { appointment_id: p.appointmentId, cancelled_inflight: 'true' },
      idempotencyKey: `cancelrefund-${p.appointmentId}`,
    });
  } catch (err) {
    await recordPaymentEvent(supabase, {
      paymentId: payment.id,
      appointmentId: p.appointmentId,
      organizationId: payment.organization_id,
      eventType: 'cancelled_inflight_refund_failed',
      actor: p.actor,
      amount: amountCents,
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
    return { refunded: false, reason: 'refund_failed' };
  }

  // initiator_user_id is null: this refund is system-issued (migration 088 relaxed the column).
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

  await supabase.from('payments').update({ status: 'refunded' }).eq('id', payment.id);

  await recordPaymentEvent(supabase, {
    paymentId: payment.id,
    appointmentId: p.appointmentId,
    organizationId: payment.organization_id,
    eventType: 'cancelled_inflight_refunded',
    prevStatus: payment.status,
    newStatus: 'refunded',
    actor: p.actor,
    amount: amountCents,
    payload: { refund_id: refund.id, payment_intent_id: p.paymentIntentId },
  });

  const ctx = await loadNotificationContext(supabase, { appointmentId: p.appointmentId });
  await recordNotificationEvent(supabase, {
    event_type: 'cancelled_job_refunded',
    appointment_id: p.appointmentId,
    organization_id: payment.organization_id,
    dedupe_key: `cancelled_job_refunded:${p.appointmentId}`,
    payload: { ...ctx, audience: 'admin', amount_cents: amountCents, refund_id: refund.id },
  });

  return { refunded: true };
}
