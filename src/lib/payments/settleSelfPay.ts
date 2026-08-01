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
 * Idempotent (a `selfpay-cleaner-${id}` key — attempt-rotated after a failed create, T1-11 — plus
 * an existing-paid-payout guard and an adopt-existing scan on retries) and best-effort: a failed
 * transfer records a `failed` payout row for the retry sweep and never throws into the webhook.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { transferGroupFor, createPlatformTransfer, listTransfersByGroup } from '@/lib/stripe/transfers';
import { transferIdempotencyKey, isIdempotencyConflictInFlight } from '@/lib/stripe/idempotencyKeys';
import { recordPaymentEvent } from './events';
import { chargeAmountRefundedCents } from './refundGuards';
import { isCleanerPayable } from './isCleanerPayable';
import { resolveSelfPayCutCents } from './payRequests/selfPayCut';

export interface SettleResult {
  settled: boolean;
  reason?: string;
}

type GroupTransfer = Awaited<ReturnType<typeof listTransfersByGroup>>[number];

// Local (not in stripe/transfers.ts) so integration tests that mock that module wholesale keep
// the real field extraction.
function transferDestinationId(t: GroupTransfer): string | null {
  return typeof t.destination === 'string' ? t.destination : t.destination?.id ?? null;
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
  const { data: existingPayout, error: existingPayoutError } = await supabase
    .from('payouts')
    .select('id, status, stripe_transfer_id, transfer_attempt')
    .eq('appointment_id', appointmentId)
    .limit(1)
    .maybeSingle();
  // A select ERROR is not "no row": proceeding on null would erase the already-paid/reversed
  // terminal guard and the attempt counter (the migration-lag window, where transfer_attempt
  // doesn't exist yet and this select 42703s, is the concrete case). Fail closed; the webhook
  // redelivery and the sweep retry after the schema/transient error heals.
  if (existingPayoutError) {
    console.error(
      'settleSelfPay: payouts select failed, bailing fail-closed',
      appointmentId,
      existingPayoutError.code,
      existingPayoutError.message,
    );
    return { settled: false, reason: 'payout_row_unreadable' };
  }
  const already = existingPayout as
    | { id: string; status: string; stripe_transfer_id: string | null; transfer_attempt: number | null }
    | null;
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
    flat_rate_cents: number | null;
  };
  let cleaner: CleanerRow | null = null;
  if (appt.cleaner_id) {
    const { data: cleanerRow } = await supabase
      .from('cleaner_profiles')
      .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent, flat_rate_cents')
      .eq('id', appt.cleaner_id)
      .maybeSingle();
    cleaner = cleanerRow as CleanerRow | null;
  }
  const cleanerPayable = !!cleaner && isCleanerPayable(cleaner);

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

  // Mode-aware cut (shared with both self-pay charge paths so the three can
  // never disagree). Request mode: the charge only ran because the thread
  // approved, but guard anyway - a not-yet-approved thread defers settlement.
  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const cut = await resolveSelfPayCutCents(supabase, {
    appointmentId,
    cleaner: cleaner!,
    jobGrossCents,
  });
  if (!cut.ok) return { settled: false, reason: 'pay_request_pending' };
  const fullCutCents = cut.cutCents;
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
    payout_percent_snapshot: cut.basis === 'percent' ? cut.payoutPercent : null,
    payout_model_snapshot: cut.basis === 'percent' ? 'percentage' : cut.basis,
    pay_request_id: cut.payRequestId,
    is_self_pay: true,
  };

  const upsertPayout = async (fields: Record<string, unknown>) => {
    if (already) {
      const { error: updateError } = await supabase.from('payouts').update(fields).eq('id', already.id);
      if (updateError) {
        console.error(
          'self-pay payout update failed for appointment',
          appointmentId,
          updateError.code,
          updateError.message,
        );
      }
    } else {
      const { error: insertError } = await supabase.from('payouts').insert(fields);
      if (insertError && insertError.code === '23505') {
        // A concurrent settlement inserted the row first (unique index, migration 088); its
        // writer owns the state, and the transfer idempotency key already collapsed the money
        // side, so losing this race is benign.
        console.log('self-pay payout insert lost a benign race for appointment', appointmentId);
      } else if (insertError) {
        // Not the benign race: a silently dropped 'failed' row would hide the cut from every
        // sweep (no payout row = nothing re-selects the appointment).
        console.error(
          'self-pay payout insert failed for appointment',
          appointmentId,
          insertError.code,
          insertError.message,
        );
      }
    }
  };

  // T1-11: idempotency-key rotation counter (see settleCleanerPayout). First settlement has no
  // row, so it always uses the historical unsuffixed key.
  const attempt = Number(already?.transfer_attempt ?? 0);

  // A prior attempt can create the transfer at Stripe but LOSE the response: the catch below then
  // writes a 'failed' row with a NULL transfer_id and bumps the attempt, so the retry's ROTATED
  // key would not collide with the transfer that actually landed — it would double-pay. On any
  // retry (a prior row exists), adopt an existing cleaner transfer from the group instead of
  // issuing a new one. At attempt>0 the scan is the ONLY double-pay guard, so its failure modes
  // fail CLOSED (bail, no bump, next sweep retries). (First settlement has no row, so the extra
  // list is skipped there.)
  if (already) {
    let groupTransfers: GroupTransfer[] | null = null;
    try {
      groupTransfers = await listTransfersByGroup(transferGroup);
    } catch {
      if (attempt > 0) {
        console.error(
          'settleSelfPay: transfer_group scan failed before a rotated create, bailing fail-closed',
          appointmentId,
        );
        return { settled: false, reason: 'cleaner_adopt_scan_unavailable' };
      }
      // Attempt 0: the constant key still replays/collides — safe to fall through.
    }
    if (groupTransfers) {
      const existingTransfer =
        groupTransfers.find((t) => transferDestinationId(t) === cleaner!.stripe_connect_account_id) ??
        null;
      if (!existingTransfer && attempt > 0 && groupTransfers.length > 0) {
        // A transfer to any OTHER account in this group is likely our cut paid to a since-reset
        // Connect account (a self-pay group contains only the cleaner-cut leg): a rotated create
        // would pay the cut twice. Refuse; this needs a human (or the reset-route guard).
        console.error(
          'settleSelfPay: transfer to an unrecognized account in group, refusing rotated create',
          appointmentId,
        );
        return { settled: false, reason: 'cleaner_adopt_ambiguous' };
      }
      if (existingTransfer) {
        // Record what the cleaner actually NETTED: reversals never shrink Transfer.amount, they
        // accumulate in amount_reversed.
        const adoptedNetCents = Math.max(
          0,
          existingTransfer.amount - (existingTransfer.amount_reversed ?? 0),
        );
        if (adoptedNetCents <= 0) {
          // Fully clawed back before adoption: the cut is gone, retire the row so the sweep
          // stops re-selecting it.
          await upsertPayout({
            ...payoutBase,
            status: 'reversed',
            stripe_transfer_id: existingTransfer.id,
            reversed_at: new Date().toISOString(),
          });
          await recordPaymentEvent(supabase, {
            appointmentId,
            organizationId: appt.organization_id,
            eventType: 'cleaner_slice_refund_absorbed',
            prevStatus: already.status,
            newStatus: 'reversed',
            actor: 'webhook',
            amount: existingTransfer.amount,
            payload: { transfer_id: existingTransfer.id, source: 'settle-adopt-existing', self_pay: true },
          });
          return { settled: true, reason: 'payout_adopted_reversed' };
        }
        await upsertPayout({
          ...payoutBase,
          amount: adoptedNetCents / 100,
          status: 'paid',
          stripe_transfer_id: existingTransfer.id,
          paid_at: new Date().toISOString(),
        });
        await recordPaymentEvent(supabase, {
          appointmentId,
          organizationId: appt.organization_id,
          eventType: 'cleaner_payout_repaired',
          prevStatus: already.status,
          newStatus: 'paid',
          actor: 'webhook',
          amount: adoptedNetCents,
          payload: { transfer_id: existingTransfer.id, source: 'settle-adopt-existing', self_pay: true },
        });
        return { settled: true, reason: 'payout_adopted_existing' };
      }
    }
  }

  let transfer;
  try {
    transfer = await createPlatformTransfer({
      destinationAccountId: cleaner!.stripe_connect_account_id!,
      amountCents: cleanerCutCents,
      sourceTransactionId: platformChargeId,
      transferGroup,
      idempotencyKey: transferIdempotencyKey(`selfpay-cleaner-${appointmentId}`, attempt),
      appointmentId,
    });
  } catch (err) {
    // Rotate the key for the NEXT retry (T1-11); the adopt-existing scan above guards every
    // rotated create against a lost-response transfer that actually landed. EXCEPT a concurrent
    // in-flight conflict: the winner's create is still running and will become this key's cached
    // result — rotating would let an immediate retry race it into a second transfer.
    const nextAttempt = isIdempotencyConflictInFlight(err) ? attempt : attempt + 1;
    await upsertPayout({ ...payoutBase, status: 'failed', transfer_attempt: nextAttempt });
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
