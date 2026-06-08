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
 * key + a payout `status='reversed'` guard) and best-effort: a failed reversal records a
 * `cleaner_clawback_failed` ledger event (which the reconcile sweep retries) and NEVER throws, so
 * a webhook handler always returns 200 and the refund route never strands the homeowner.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listTransfersByGroup, reversePlatformTransfer, transferGroupFor } from '@/lib/stripe/transfers';
import { recordPaymentEvent } from './events';

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
  };

  const payout = await loadCleanerPayout(supabase, p.appointmentId);
  if (!payout?.stripe_transfer_id) return { ...base, noPayout: true };
  // Durable idempotency: a reversed payout means a prior delivery (webhook / cron / route) already
  // clawed it back. Skip without calling Stripe — covers retries beyond the idempotency-key window.
  if (payout.status === 'reversed') return { ...base, alreadyReversed: true };

  const cents = p.reversalCents ?? Math.round(Number(payout.amount) * 100);
  if (cents <= 0) return base;

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
        // A failed REFUND reversal self-heals via the charge.refunded webhook re-running this with
        // cumulative amount_reversed math, so record a DISTINCT type the full-clawback sweep
        // ignores: retryStrandedClawbacks reverses the FULL payout, which would over-claw-back what
        // was only a partial refund. (clawbackCleanerPayout still uses cleaner_clawback_failed.)
        eventType: isCleanerTransfer ? 'refund_clawback_failed' : 'transfer_reversal_failed',
        actor: p.actor,
        amount: reversalCents,
        payload: { transfer_id: t.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return { reversedCents, failures };
}
