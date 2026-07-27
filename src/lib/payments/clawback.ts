/**
 * Unified, idempotent clawback of cleaner/tenant transfers (PR2 of the payment hardening).
 *
 * Generalizes the dispute-lost clawback so every "money came back" path reverses the cleaner
 * payout the same way:
 *   - a lost dispute (tenant absorbs the remainder, cleaner cut is clawed back),
 *   - an ACH debit that returns AFTER settlement (the cleaner was already paid),
 *   - a refund issued OUT OF BAND (Stripe Dashboard) that the in-app route didn't unwind,
 *   - the reconcile retry for a stranded clawback.
 *
 * Two entry points:
 *   - `clawbackCleanerPayout`        — reverse the WHOLE cleaner payout (dispute / ACH return).
 *   - `reverseJobTransfersForRefund` — proportionally unwind the entire job transfer group
 *                                      (tenant remainder + cleaner) for a homeowner refund.
 *
 * Both are idempotent (Stripe's `amount_reversed` caps every reversal + a per-target idempotency
 * key + a payout `status='reversed'` guard) and best-effort: a failed reversal records a ledger
 * event the reconcile sweep retries (`cleaner_clawback_failed` → retryStrandedClawbacks;
 * `refund_clawback_failed`/`transfer_reversal_failed` → retryStrandedRefundUnwinds) and NEVER
 * throws, so a webhook handler always returns 200 and the refund route never strands the homeowner.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listTransfersByGroup,
  reversePlatformTransfer,
  retrievePlatformTransfer,
  transferGroupFor,
} from '@/lib/stripe/transfers';
import { recordPaymentEvent } from './events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { loadNotificationContext } from '@/lib/notifications/context';

export type ClawbackReason =
  | 'dispute_lost'
  | 'ach_return'
  | 'refund'
  | 'reconcile_retry';

/** Ledger event_type recorded on a SUCCESSFUL cleaner-payout clawback, by cause. */
const SUCCESS_EVENT_BY_REASON: Record<ClawbackReason, string> = {
  dispute_lost: 'dispute_lost_clawback',
  ach_return: 'ach_return_clawback',
  refund: 'refund_clawback',
  reconcile_retry: 'cleaner_clawback_retried',
};

interface PayoutRow {
  id: string;
  amount: number | string;
  stripe_transfer_id: string | null;
  status: string;
  /** Locked cleaner percent frozen at charge time (T1-13); null on pre-snapshot legacy rows. */
  payout_percent_snapshot: number | string | null;
}

export interface ClawbackCleanerParams {
  appointmentId: string;
  /** Reverse only this many cents (rare); omit to reverse the full recorded payout. */
  reversalCents?: number;
  actor: string;
  reason: ClawbackReason;
  stripeEventId?: string | null;
  paymentId?: string | null;
  organizationId?: string | null;
}

export interface ClawbackResult {
  reversed: boolean;
  /** The payout was already 'reversed' (idempotent no-op). */
  alreadyReversed: boolean;
  /** No cleaner payout/transfer exists for this appointment (nothing to claw back). */
  noPayout: boolean;
  reversedCents: number;
  /** The Stripe reversal threw; a `cleaner_clawback_failed` event was recorded for the sweep. */
  failed: boolean;
  /** Funds already reached the cleaner's bank (`bank_paid`): surfaced for ops, never auto-reversed. */
  blocked: boolean;
}

async function loadCleanerPayout(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<PayoutRow | null> {
  const { data } = await supabase
    .from('payouts')
    .select('id, amount, stripe_transfer_id, status, payout_percent_snapshot')
    .eq('appointment_id', appointmentId)
    .not('stripe_transfer_id', 'is', null)
    .limit(1);
  return data && data.length > 0 ? (data[0] as PayoutRow) : null;
}

/**
 * Funds already reached the cleaner's bank ('bank_paid'): reversing the transfer would drive their
 * connected balance negative with no predictable recovery. Surface it for an ops decision (net
 * against future jobs, invoice the cleaner) instead of auto-reversing. Shared by the full clawback
 * (dispute / ACH return) and the refund unwind so both honor the same policy. One ledger event +
 * one deduped notification per appointment; every later call is a cheap no-op (audit T1-2).
 */
async function recordBankPaidBlock(
  supabase: SupabaseClient,
  p: {
    appointmentId: string;
    paymentId?: string | null;
    organizationId?: string | null;
    stripeEventId?: string | null;
    actor: string;
    reason: ClawbackReason;
    transferId: string;
    blockedCents: number;
  },
): Promise<void> {
  const { data: priorBlock } = await supabase
    .from('payment_events')
    .select('id')
    .eq('appointment_id', p.appointmentId)
    .eq('event_type', 'clawback_blocked_bank_paid')
    .limit(1)
    .maybeSingle();
  if (priorBlock) return;
  await recordPaymentEvent(supabase, {
    paymentId: p.paymentId ?? null,
    appointmentId: p.appointmentId,
    organizationId: p.organizationId ?? null,
    stripeEventId: p.stripeEventId ?? null,
    eventType: 'clawback_blocked_bank_paid',
    actor: p.actor,
    amount: p.blockedCents,
    payload: { transfer_id: p.transferId, reason: p.reason },
  });
  if (p.organizationId) {
    const ctx = await loadNotificationContext(supabase, { appointmentId: p.appointmentId });
    await recordNotificationEvent(supabase, {
      event_type: 'clawback_blocked',
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      dedupe_key: `clawback_blocked:${p.appointmentId}`,
      payload: { ...ctx, audience: 'admin', amount_cents: p.blockedCents, reason: p.reason },
    });
  }
}

/**
 * Reverse the cleaner's payout transfer in full (or `reversalCents`). Used when funds came back
 * but the homeowner is NOT being refunded the tenant remainder (lost dispute, ACH return) — the
 * tenant keeps theirs; only the cleaner's cut is clawed back. Idempotent + never throws.
 */
export async function clawbackCleanerPayout(
  supabase: SupabaseClient,
  p: ClawbackCleanerParams,
): Promise<ClawbackResult> {
  const base: ClawbackResult = {
    reversed: false,
    alreadyReversed: false,
    noPayout: false,
    reversedCents: 0,
    failed: false,
    blocked: false,
  };

  const payout = await loadCleanerPayout(supabase, p.appointmentId);
  if (!payout?.stripe_transfer_id) return { ...base, noPayout: true };
  // Durable idempotency: a reversed payout means a prior delivery (webhook / cron / route) already
  // clawed it back. Skip without calling Stripe — covers retries beyond the idempotency-key window.
  if (payout.status === 'reversed') return { ...base, alreadyReversed: true };

  // Once the funds have LEFT Stripe for the cleaner's bank, surface for ops instead of auto-reversing.
  if (payout.status === 'bank_paid') {
    await recordBankPaidBlock(supabase, {
      appointmentId: p.appointmentId,
      paymentId: p.paymentId,
      organizationId: p.organizationId,
      stripeEventId: p.stripeEventId,
      actor: p.actor,
      reason: p.reason,
      transferId: payout.stripe_transfer_id!,
      blockedCents: Math.round(Number(payout.amount) * 100),
    });
    return { ...base, blocked: true };
  }

  const requestedCents = p.reversalCents ?? Math.round(Number(payout.amount) * 100);
  if (requestedCents <= 0) return base;

  // Cap the ask at what Stripe still allows on this transfer: a prior partial reversal (e.g. a
  // partial refund's proportional unwind) lowers the ceiling, and over-asking throws on every
  // retry — turning the failed-clawback sweep into a permanent loop. If nothing is left, the
  // transfer is already fully reversed at Stripe; mirror that and stop.
  let cents = requestedCents;
  try {
    const transfer = await retrievePlatformTransfer(payout.stripe_transfer_id);
    const remaining = Math.max(0, transfer.amount - (transfer.amount_reversed ?? 0));
    if (remaining <= 0) {
      await supabase
        .from('payouts')
        .update({ status: 'reversed', reversed_at: new Date().toISOString() })
        .eq('id', payout.id);
      await recordPaymentEvent(supabase, {
        paymentId: p.paymentId ?? null,
        appointmentId: p.appointmentId,
        organizationId: p.organizationId ?? null,
        stripeEventId: p.stripeEventId ?? null,
        eventType: SUCCESS_EVENT_BY_REASON[p.reason],
        actor: p.actor,
        amount: 0,
        payload: { transfer_id: payout.stripe_transfer_id, reason: p.reason, already_fully_reversed: true },
      });
      return { ...base, alreadyReversed: true };
    }
    cents = Math.min(requestedCents, remaining);
  } catch {
    // Transfer unreadable: try the reversal with the requested amount; a real over-ask fails
    // below into cleaner_clawback_failed and the sweep retries once Stripe is reachable.
  }

  try {
    await reversePlatformTransfer(
      payout.stripe_transfer_id,
      cents,
      `clawback-${p.appointmentId}-${payout.stripe_transfer_id}-${p.reason}`,
    );
    await supabase
      .from('payouts')
      .update({ status: 'reversed', reversed_at: new Date().toISOString() })
      .eq('id', payout.id);
    await recordPaymentEvent(supabase, {
      paymentId: p.paymentId ?? null,
      appointmentId: p.appointmentId,
      organizationId: p.organizationId ?? null,
      stripeEventId: p.stripeEventId ?? null,
      eventType: SUCCESS_EVENT_BY_REASON[p.reason],
      actor: p.actor,
      amount: cents,
      payload: { transfer_id: payout.stripe_transfer_id, reason: p.reason },
    });
    return { ...base, reversed: true, reversedCents: cents };
  } catch (err) {
    // Record the failure under the name the reconcile sweep retries; never throw back.
    await recordPaymentEvent(supabase, {
      paymentId: p.paymentId ?? null,
      appointmentId: p.appointmentId,
      organizationId: p.organizationId ?? null,
      stripeEventId: p.stripeEventId ?? null,
      eventType: 'cleaner_clawback_failed',
      actor: p.actor,
      amount: cents,
      payload: {
        transfer_id: payout.stripe_transfer_id,
        reason: p.reason,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { ...base, failed: true };
  }
}

/**
 * How many cents to reverse on a transfer NOW so that its CUMULATIVE reversed amount matches the
 * proportion of the job that has been refunded. Cumulative (target minus what Stripe already
 * reversed) so a series of partial refunds tops up correctly and a replay is a no-op. Pure.
 */
export function proportionalReversalCents(args: {
  transferAmount: number;
  transferAmountReversed: number;
  totalRefundedCents: number;
  grossCents: number;
}): number {
  const { transferAmount, transferAmountReversed, totalRefundedCents, grossCents } = args;
  if (grossCents <= 0 || transferAmount <= 0) return 0;
  const targetReversed = Math.min(
    transferAmount,
    Math.round((transferAmount * totalRefundedCents) / grossCents),
  );
  const toReverse = targetReversed - Math.max(0, transferAmountReversed);
  return toReverse > 0 ? toReverse : 0;
}

/**
 * T1-12a: per-leg reversal plan from the SPLIT INVARIANT rather than raw proportion. Settlement
 * splits transfers from `splitBase = captured − processingFee − refundedAtSettlement`
 * (settleCleanerPayout), so a transfer's size says nothing about what fraction of the CURRENT
 * cumulative refund it owes — proportional-to-gross over-claws every leg that was split net of an
 * earlier refund. Instead, recompute the split each party would hold if the FULL cumulative
 * refund had preceded settlement (the same formula T1-13 locked for late-settled held slices,
 * making refund-then-settle and settle-then-refund converge on identical end states) and reverse
 * each leg down to that share:
 *
 *   B = max(0, captured − processingFee − totalRefunded)
 *   split = computePaymentSplit(B, payoutPercent, platformFeeBps)
 *   cleaner reverses down to split.cleanerCents; tenant legs down to split.tenantRemainderCents.
 *
 * The platform's fee share shrinks with B (Bridger 2026-07-26: the fee is given back
 * proportionally on refunds), and the platform recovers the processing-fee share from the org
 * side (Stripe keeps its fee on refunds; pre-T1-12a the platform silently absorbed it, which
 * also broke order-independence with T1-13).
 *
 * Pure. Cumulative + clamped, so replays and partial-refund series top up exactly like the
 * proportional math did. Multiple tenant legs (rare retry-created siblings) allocate the
 * aggregate target deterministically (sorted by transfer id) so a replay recomputes the
 * identical plan and the idempotency keys line up.
 */
export interface ReversalLeg {
  id: string;
  amount: number;
  amountReversed: number;
}

export function invariantReversalPlan(args: {
  capturedCents: number;
  processingFeeCents: number;
  totalRefundedCents: number;
  /** Locked cleaner percent (payouts.payout_percent_snapshot); 0 when no cleaner leg exists. */
  payoutPercent: number;
  /** Locked fee bps (payments.application_fee_bps_snapshot). */
  platformFeeBps: number;
  cleanerTransfer: ReversalLeg | null;
  tenantTransfers: ReversalLeg[];
}): Map<string, number> {
  const targetBase = Math.max(
    0,
    args.capturedCents - args.processingFeeCents - args.totalRefundedCents,
  );
  const split = computePaymentSplit({
    grossCents: targetBase,
    payoutPercent: args.payoutPercent,
    platformFeeBps: args.platformFeeBps,
  });

  const plan = new Map<string, number>();

  if (args.cleanerTransfer) {
    const t = args.cleanerTransfer;
    const targetReversed = Math.min(t.amount, Math.max(0, t.amount - split.cleanerCents));
    const toReverse = targetReversed - Math.max(0, t.amountReversed);
    plan.set(t.id, toReverse > 0 ? toReverse : 0);
  }

  const tenantLegs = [...args.tenantTransfers].sort((a, b) => a.id.localeCompare(b.id));
  const tenantAmountTotal = tenantLegs.reduce((s, t) => s + t.amount, 0);
  const tenantAlreadyTotal = tenantLegs.reduce((s, t) => s + Math.max(0, t.amountReversed), 0);
  const tenantTargetReversed = Math.min(
    tenantAmountTotal,
    Math.max(0, tenantAmountTotal - split.tenantRemainderCents),
  );
  let tenantToReverse = Math.max(0, tenantTargetReversed - tenantAlreadyTotal);
  for (const t of tenantLegs) {
    const capacity = Math.max(0, t.amount - Math.max(0, t.amountReversed));
    const take = Math.min(capacity, tenantToReverse);
    plan.set(t.id, take);
    tenantToReverse -= take;
  }

  return plan;
}

export interface RefundUnwindParams {
  appointmentId: string;
  /** CUMULATIVE refunded cents for the job (prior refunds + this one). */
  totalRefundedCents: number;
  /** The job's gross (the charged amount the transfers were split from), in cents. */
  grossCents: number;
  actor: string;
  stripeEventId?: string | null;
  paymentId?: string | null;
  organizationId?: string | null;
  /**
   * The platform charge being refunded. Every charge on an appointment shares one transfer_group,
   * so a refund of (say) the completion charge would otherwise reverse a cancellation fee's tenant
   * transfer in the same group — clawing back money the org is owed. When set, reversals are scoped
   * to transfers funded by THIS charge. Omit when the charge is unknown (legacy); then every group
   * transfer is eligible, as before. (audit T1-12)
   */
  sourceChargeId?: string | null;
}

export interface RefundUnwindResult {
  reversedCents: number;
  failures: number;
}

/**
 * Proportionally unwind EVERY transfer in the job's group (tenant remainder + cleaner) to match
 * the cumulative refund, and mirror the cleaner payout to 'reversed' once its transfer is fully
 * reversed. Used by the in-app refund route AND by the `charge.refunded` webhook (so an out-of-band
 * Dashboard refund also claws back). Idempotent via cumulative `amount_reversed` math; never throws.
 */
export async function reverseJobTransfersForRefund(
  supabase: SupabaseClient,
  p: RefundUnwindParams,
): Promise<RefundUnwindResult> {
  const transferGroup = transferGroupFor(p.appointmentId);
  let transfers: Awaited<ReturnType<typeof listTransfersByGroup>> = [];
  try {
    transfers = await listTransfersByGroup(transferGroup);
  } catch (err) {
    await recordPaymentEvent(supabase, {
      paymentId: p.paymentId ?? null,
      appointmentId: p.appointmentId,
      organizationId: p.organizationId ?? null,
      stripeEventId: p.stripeEventId ?? null,
      eventType: 'transfer_list_failed',
      actor: p.actor,
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
    return { reversedCents: 0, failures: 1 };
  }

  // Scope to the refunded charge: only reverse transfers funded by it, never a sibling charge's
  // (e.g. a cancellation fee) transfer that shares this appointment's transfer_group (audit T1-12).
  // Keep transfers with no source_transaction (rare retry-created legs) so we never drop our own.
  if (p.sourceChargeId) {
    transfers = transfers.filter((t) => {
      const src = typeof t.source_transaction === 'string' ? t.source_transaction : null;
      return src === null || src === p.sourceChargeId;
    });
  }

  const payout = await loadCleanerPayout(supabase, p.appointmentId);

  // T1-12a: prefer the split-invariant plan (reverse each leg down to its share of the
  // refund-shrunk base) over raw proportion-to-gross, which over-claws any leg that settlement
  // split net of an earlier refund. `application_fee_bps_snapshot` gates the ERA (pre-snapshot
  // rows were split from gross, where the two formulas agree, so they keep the proportional
  // math); the fee VALUE itself is the live org bps, because that is what settlement and the
  // T1-13 carved-slice recompute actually split with. Every unreadable/invalid input bails
  // fail-closed (the refund stands; the stranded-unwind sweep retries with fresh state).
  const bailUnwind = async (reason: string, detail: string): Promise<RefundUnwindResult> => {
    await recordPaymentEvent(supabase, {
      paymentId: p.paymentId ?? null,
      appointmentId: p.appointmentId,
      organizationId: p.organizationId ?? null,
      stripeEventId: p.stripeEventId ?? null,
      eventType: 'transfer_list_failed',
      actor: p.actor,
      payload: { reason, error: detail },
    });
    return { reversedCents: 0, failures: 1 };
  };

  let plan: Map<string, number> | null = null;
  if (p.paymentId) {
    const { data: snapRow, error: snapErr } = await supabase
      .from('payments')
      .select('processing_fee_cents, application_fee_bps_snapshot')
      .eq('id', p.paymentId)
      .maybeSingle();
    // A vanished row is as wrong as an unreadable one — never guess which formula applies.
    if (snapErr || !snapRow) {
      return bailUnwind('split_snapshot_unreadable', snapErr?.message ?? 'payment row missing');
    }
    const snap = snapRow as {
      processing_fee_cents: number | null;
      application_fee_bps_snapshot: number | null;
    };
    if (snap.application_fee_bps_snapshot != null) {
      // The carved cleaner percent comes from ANY payout row for the appointment: a HELD or
      // failed slice (stripe_transfer_id null — invisible to loadCleanerPayout above) still had
      // its percent carved OUT of the tenant transfer at settlement, so planning with 0 would
      // hand the cleaner's share to the tenant as keep-target and under-claw it. No payout row
      // at all means no share was ever carved (hourly_external / percent 0), where 0 is right;
      // a payout row without the snapshot is pre-snapshot-era → proportional fallback.
      const { data: pctRows, error: pctErr } = await supabase
        .from('payouts')
        .select('payout_percent_snapshot')
        .eq('appointment_id', p.appointmentId)
        .limit(1);
      if (pctErr) return bailUnwind('split_snapshot_unreadable', pctErr.message);
      const pctRow = ((pctRows ?? [])[0] ?? null) as
        | { payout_percent_snapshot: number | string | null }
        | null;
      const carvedPercent =
        pctRow == null
          ? 0
          : pctRow.payout_percent_snapshot != null
            ? Number(pctRow.payout_percent_snapshot)
            : null;

      // Mixed-charge ambiguity: the sourceChargeId filter deliberately KEEPS null-source legs
      // (sweep-settled transfers carry none), but on an appointment with another live charge a
      // null-source leg may belong to the SIBLING charge — and the aggregate tenant target would
      // claw it in full. Fall back to the bounded per-leg proportional math there (the sweep's
      // Guard 1 routes the same shape to manual review).
      let ambiguous = false;
      const hasNullSourceLeg = transfers.some((t) => typeof t.source_transaction !== 'string');
      if (hasNullSourceLeg) {
        const { data: otherCharged, error: otherErr } = await supabase
          .from('payments')
          .select('id')
          .eq('appointment_id', p.appointmentId)
          .neq('id', p.paymentId)
          .or('charge_kind.eq.cancellation_fee,stripe_payment_intent_id.not.is.null')
          .in('status', ['paid', 'processing'])
          .limit(1);
        if (otherErr) return bailUnwind('split_snapshot_unreadable', otherErr.message);
        ambiguous = ((otherCharged ?? []) as Array<{ id: string }>).length > 0;
      }

      if (carvedPercent != null && !ambiguous) {
        let liveBps: number | null = null;
        if (p.organizationId) {
          const { data: orgRow, error: orgErr } = await supabase
            .from('organizations')
            .select('platform_fee_bps')
            .eq('id', p.organizationId)
            .maybeSingle();
          if (orgErr) return bailUnwind('split_snapshot_unreadable', orgErr.message);
          const bps = (orgRow as { platform_fee_bps: number | null } | null)?.platform_fee_bps;
          liveBps = bps != null ? Number(bps) : null;
        }
        const cleanerLeg =
          payout?.stripe_transfer_id != null
            ? transfers.find((t) => t.id === payout.stripe_transfer_id) ?? null
            : null;
        const asLeg = (t: (typeof transfers)[number]) => ({
          id: t.id,
          amount: t.amount,
          amountReversed: t.amount_reversed ?? 0,
        });
        try {
          plan = invariantReversalPlan({
            capturedCents: p.grossCents,
            processingFeeCents: snap.processing_fee_cents ?? 0,
            totalRefundedCents: p.totalRefundedCents,
            payoutPercent: carvedPercent,
            platformFeeBps: liveBps ?? snap.application_fee_bps_snapshot,
            cleanerTransfer: cleanerLeg ? asLeg(cleanerLeg) : null,
            tenantTransfers: transfers.filter((t) => t !== cleanerLeg).map(asLeg),
          });
        } catch (err) {
          // computePaymentSplit validates its inputs and THROWS on corrupt snapshots (percent
          // outside 0..100, non-integer bps). This function's contract is never-throws, and a
          // silent proportional fallback could be the exact over-claw this fix removes.
          return bailUnwind(
            'split_snapshot_invalid',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }

  let reversedCents = 0;
  let failures = 0;
  for (const t of transfers) {
    const already = t.amount_reversed ?? 0;
    const reversalCents =
      plan != null
        ? plan.get(t.id) ?? 0
        : proportionalReversalCents({
            transferAmount: t.amount,
            transferAmountReversed: already,
            totalRefundedCents: p.totalRefundedCents,
            grossCents: p.grossCents,
          });
    if (reversalCents <= 0) continue;
    const isCleanerTransfer = !!payout && t.id === payout.stripe_transfer_id;

    // The cleaner's cut already reached their bank ('bank_paid'): reversing would drive their
    // connected balance negative. Block it for ops (same policy as clawbackCleanerPayout) and still
    // reverse the tenant remainder below so the platform recovers what it can (audit T1-2).
    if (isCleanerTransfer && payout!.status === 'bank_paid') {
      await recordBankPaidBlock(supabase, {
        appointmentId: p.appointmentId,
        paymentId: p.paymentId,
        organizationId: p.organizationId,
        stripeEventId: p.stripeEventId,
        actor: p.actor,
        reason: 'refund',
        transferId: t.id,
        blockedCents: Math.round(Number(payout!.amount) * 100),
      });
      continue;
    }

    try {
      await reversePlatformTransfer(
        t.id,
        reversalCents,
        `clawback-${p.appointmentId}-${t.id}-refund-${already + reversalCents}`,
      );
      reversedCents += reversalCents;
      if (isCleanerTransfer && payout) {
        const fullyReversed = already + reversalCents >= Math.round(Number(payout.amount) * 100);
        await supabase
          .from('payouts')
          .update({ status: fullyReversed ? 'reversed' : payout.status, reversed_at: new Date().toISOString() })
          .eq('id', payout.id);
      }
    } catch (err) {
      failures++;
      await recordPaymentEvent(supabase, {
        paymentId: p.paymentId ?? null,
        appointmentId: p.appointmentId,
        organizationId: p.organizationId ?? null,
        stripeEventId: p.stripeEventId ?? null,
        // Record a DISTINCT type the full-clawback sweep ignores: retryStrandedClawbacks reverses
        // the FULL payout, which would over-claw-back what was only a partial refund.
        // (clawbackCleanerPayout still uses cleaner_clawback_failed.) These types are retried by
        // retryStrandedRefundUnwinds, which re-runs THIS function with the cumulative target
        // re-derived from the Stripe charge, and alerted via paymentEventAlerts (audit T1-1).
        eventType: isCleanerTransfer ? 'refund_clawback_failed' : 'transfer_reversal_failed',
        actor: p.actor,
        amount: reversalCents,
        payload: { transfer_id: t.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return { reversedCents, failures };
}
