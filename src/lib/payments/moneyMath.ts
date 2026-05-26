/**
 * Money-math invariant check (Phase 4d reconciliation).
 *
 * Re-derives the locked split (decision #11) from gross + payout% + platform bps and compares
 * it to the cleaner payout we actually recorded. Any mismatch beyond a 1-cent rounding
 * tolerance is "drift" the reconciler flags — the forensic guarantee that a payout row was
 * never written with the wrong amount.
 *
 * Pure (delegates only to computePaymentSplit) so it unit-tests in isolation and can be reused
 * anywhere a split needs auditing.
 */
import { computePaymentSplit } from '@/lib/stripe/charges/splits';

export interface SplitInvariantArgs {
  grossCents: number;
  /** Cleaner's percentage of GROSS, 0..100. */
  payoutPercent: number;
  /** Platform fee in basis points, 0..10000. */
  platformFeeBps: number;
  /** The cleaner payout amount we actually recorded, in cents. */
  recordedCleanerCents: number;
}

export interface SplitInvariantResult {
  ok: boolean;
  expectedCleanerCents: number;
  platformFeeCents: number;
  tenantRemainderCents: number;
  recordedCleanerCents: number;
  /** recorded − expected; 0 when the recorded payout matches the locked split exactly. */
  driftCents: number;
}

/** Allow a single floor/round cent of slack between the recorded payout and the derived split. */
const TOLERANCE_CENTS = 1;

export function checkSplitInvariant(args: SplitInvariantArgs): SplitInvariantResult {
  const { grossCents, payoutPercent, platformFeeBps, recordedCleanerCents } = args;
  const split = computePaymentSplit({ grossCents, payoutPercent, platformFeeBps });
  const driftCents = recordedCleanerCents - split.cleanerCents;
  return {
    ok: Math.abs(driftCents) <= TOLERANCE_CENTS,
    expectedCleanerCents: split.cleanerCents,
    platformFeeCents: split.platformFeeCents,
    tenantRemainderCents: split.tenantRemainderCents,
    recordedCleanerCents,
    driftCents,
  };
}
