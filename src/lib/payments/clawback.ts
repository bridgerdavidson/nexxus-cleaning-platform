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
    .select('id, amount, stripe_transfer_id, status')
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

  let reversedCents = 0;
  let failures = 0;
  for (const t of transfers) {
    const already = t.amount_reversed ?? 0;
    const reversalCents = proportionalReversalCents({
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
