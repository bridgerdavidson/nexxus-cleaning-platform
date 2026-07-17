import type { ChargeProjection } from '@/types';
import type { FullChargeBreakdown } from './projectCompletionCharge';

/**
 * Applies the org's cleaner pay-display setting to a full breakdown, producing
 * the {@link ChargeProjection} that is safe to send to the requesting viewer.
 *
 * PRIVACY: when the org chose `payout_only` AND the viewer is the assigned
 * cleaner, the customer charge AND the payout percentage are OMITTED from the
 * returned object (not merely hidden). Exposing the cut together with the
 * percentage would let the cleaner back-compute the customer charge, which
 * defeats the privacy goal, so both are dropped. Org staff (owner/admin/manager)
 * are never `isCleanerViewer`, so they always receive the full breakdown.
 */
export function presentChargeProjection(
  full: FullChargeBreakdown,
  opts: { display: 'full' | 'payout_only'; isCleanerViewer: boolean },
): ChargeProjection {
  if (opts.display === 'payout_only' && opts.isCleanerViewer) {
    return {
      display: 'payout_only',
      cleanerCutCents: full.cleanerCutCents,
      isSelfPay: full.isSelfPay,
    };
  }
  return {
    display: 'full',
    cleanerCutCents: full.cleanerCutCents,
    isSelfPay: full.isSelfPay,
    baseCents: full.baseCents,
    method: full.method,
    chargeCents: full.chargeCents,
    feeCents: full.feeCents,
    platformFeeCents: full.platformFeeCents,
    payoutPercent: full.payoutPercent,
  };
}
