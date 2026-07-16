/**
 * Settle a captured ORG self-pay charge → pay the cleaner.
 *
 * Sibling of `settleCleanerPayout`, but far simpler: there is NO tenant remainder (the org IS
 * the tenant — it paid for its own cleaning). The captured funds sit on the PLATFORM balance and
 * a SINGLE platform→connected transfer pays the cleaner.
 *
 * Crucially, the cleaner is paid the EXACT cut derived from the job price × payout% (via
 * computeSelfPayAmounts), NOT the captured amount — the captured amount was grossed up to cover
 * the platform fee (platform_fee_bps of the job gross) and Stripe's processing fee. Transferring
 * only the cut is what RETAINS the platform fee (plus any gross-up overshoot) on the platform
 * balance; there is no separate fee transfer. Never short the cleaner, never overpay them.
 *
 * Idempotent (a `selfpay-cleaner-${id}` key + an existing-paid-payout guard) and best-effort:
 * a failed transfer records a `failed` payout row for the retry sweep and never throws into the
 * webhook.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeSelfPayAmounts } from './selfPayMath';
import { transferGroupFor, createPlatformTransfer } from '@/lib/stripe/transfers';
import { recordPaymentEvent } from './events';
import { chargeAmountRefundedCents } from './refundGuards';

export interface SettleResult {
  settled: boolean;
  reason?: string;
}

export async function settleSelfPay(
  supabase: SupabaseClient,
  appointmentId: string,
  /** The PLATFORM charge id (PaymentIntent.latest_charge) to source the transfer from. */
  platformChargeId: string | null,
): Promise<SettleResult> {
  const { data: apptRow } = await supabase
    .from('appointments')
    .select('cleaner_id, organization_id, total_price, status, is_self_pay')
    .eq('id', appointmentId)
    .maybeSingle();
  const appt = apptRow as
    | {
        cleaner_id: string | null;
        organization_id: string;
        total_price: number | string;
        status: string;
        is_self_pay: boolean;
      }
    | null;
  if (!appt) return { settled: false, reason: 'no_appointment' };
  if (!appt.is_self_pay) return { settled: false, reason: 'not_self_pay' };

  // Already paid? (retry / duplicate webhook). The idempotency key also protects the transfer,
  // but a stored paid payout lets us short-circuit before re-deriving anything.
  const { data: existingPayout } = await supabase
    .from('payouts')
    .select('id, status, stripe_transfer_id')
    .eq('appointment_id', appointmentId)
    .limit(1)
    .maybeSingle();
  const already = existingPayout as { id: string; status: string; stripe_transfer_id: string | null } | null;
  // 'paid'/'bank_paid' = settled; 'reversed' = clawed back, never re-paid.
  if (already?.stripe_transfer_id && ['paid', 'bank_paid', 'reversed'].includes(already.status)) {
    return { settled: true };
  }

  // A cancelled job never pays the cleaner (the hold is released, not captured — but guard anyway).
  if (appt.status === 'cancelled') return { settled: false, reason: 'cancelled' };

  // Money already refunded to the org must never fund the cleaner cut (audit H2): an out-of-band
  // refund (or charge.refunded racing payment_intent.succeeded) can land before settlement, when
  // there are no transfers to reverse. Read the charge's cumulative amount_refunded; if Stripe is
  // unreadable, the DB's terminal 'refunded' still blocks a known-refunded row.
  const { data: payRow } = await supabase
    .from('payments')
    .select('amount, status, stripe_payment_intent_id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const paymentRow = payRow as
    | { amount: number | string; status: string; stripe_payment_intent_id: string | null }
    | null;
  const capturedCents = paymentRow
    ? Math.round(Number(paymentRow.amount) * 100)
    : Math.round(Number(appt.total_price) * 100);
  let refundedCents = await chargeAmountRefundedCents({
    platformChargeId,
    paymentIntentId: paymentRow?.stripe_payment_intent_id ?? null,
  });
  if (refundedCents == null) {
    refundedCents = paymentRow?.status === 'refunded' ? capturedCents : 0;
  }
  if (capturedCents > 0 && refundedCents >= capturedCents) {
    // Fully refunded: nothing to pay. Retire any retryable payout row so sweeps stop re-selecting it.
    await supabase
      .from('payouts')
      .update({ status: 'reversed', reversed_at: new Date().toISOString() })
      .eq('appointment_id', appointmentId)
      .in('status', ['pending', 'failed']);
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'settlement_skipped_refunded',
      actor: 'webhook',
      amount: refundedCents,
      payload: { captured_cents: capturedCents, self_pay: true },
    });
    return { settled: false, reason: 'fully_refunded' };
  }

  // Cleaner must be payout-capable. The booking + authorize gates already enforce this; if the
  // cleaner became unpayable between hold and capture, soft-fail so it can be retried/resolved
  // (the org was charged; the funds are safe on the platform until the cleaner is paid).
  type CleanerRow = {
    payout_model: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_onboarding_complete: boolean;
    payout_percent: number | string;
  };
  let cleaner: CleanerRow | null = null;
  if (appt.cleaner_id) {
    const { data: cleanerRow } = await supabase
      .from('cleaner_profiles')
      .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent')
      .eq('id', appt.cleaner_id)
      .maybeSingle();
    cleaner = cleanerRow as CleanerRow | null;
  }
  const cleanerPayable =
    !!cleaner &&
    cleaner.payout_model !== 'hourly_external' &&
    !!cleaner.stripe_connect_account_id &&
    cleaner.stripe_connect_onboarding_complete &&
    Number(cleaner.payout_percent) > 0;

  if (!cleanerPayable) {
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'cleaner_transfer_failed',
      newStatus: 'failed',
      actor: 'webhook',
      amount: 0,
      payload: { reason: 'cleaner_not_payable_at_settlement', self_pay: true },
    });
    return { settled: false, reason: 'cleaner_not_payable' };
  }

  const payoutPercent = Number(cleaner!.payout_percent);
  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const { cleanerCutCents: fullCutCents } = computeSelfPayAmounts({ jobGrossCents, payoutPercent });
  // A PARTIAL pre-settlement refund shrinks the pool the cut can draw from; the cut is normally
  // well under the grossed-up captured amount, so this cap only binds when money went back.
  const cleanerCutCents = Math.min(fullCutCents, Math.max(0, capturedCents - refundedCents));
  if (cleanerCutCents <= 0) return { settled: false, reason: 'nothing_to_pay' };

  const transferGroup = transferGroupFor(appointmentId);
  const payoutBase = {
    organization_id: appt.organization_id,
    cleaner_id: appt.cleaner_id,
    appointment_id: appointmentId,
    amount: cleanerCutCents / 100,
    payout_percent_snapshot: payoutPercent,
    is_self_pay: true,
  };

  const upsertPayout = async (fields: Record<string, unknown>) => {
    if (already) {
      await supabase.from('payouts').update(fields).eq('id', already.id);
    } else {
      const { error: insertError } = await supabase.from('payouts').insert(fields);
      if (insertError && insertError.code === '23505') {
        // A concurrent settlement inserted the row first (unique index, migration 088); its
        // writer owns the state, and the transfer idempotency key already collapsed the money
        // side, so losing this race is benign.
        console.log('self-pay payout insert lost a benign race for appointment', appointmentId);
      }
    }
  };

  let transfer;
  try {
    transfer = await createPlatformTransfer({
      destinationAccountId: cleaner!.stripe_connect_account_id!,
      amountCents: cleanerCutCents,
      sourceTransactionId: platformChargeId,
      transferGroup,
      idempotencyKey: `selfpay-cleaner-${appointmentId}`,
      appointmentId,
    });
  } catch (err) {
    await upsertPayout({ ...payoutBase, status: 'failed' });
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'cleaner_transfer_failed',
      newStatus: 'failed',
      actor: 'webhook',
      amount: cleanerCutCents,
      payload: { error: err instanceof Error ? err.message : String(err), self_pay: true },
    });
    return { settled: false, reason: 'cleaner_transfer_failed' };
  }

  await upsertPayout({
    ...payoutBase,
    status: 'paid',
    stripe_transfer_id: transfer.id,
    paid_at: new Date().toISOString(),
  });
  await recordPaymentEvent(supabase, {
    appointmentId,
    organizationId: appt.organization_id,
    eventType: 'cleaner_paid',
    newStatus: 'paid',
    actor: 'webhook',
    amount: cleanerCutCents,
    payload: { transfer_id: transfer.id, self_pay: true },
  });

  return { settled: true };
}
