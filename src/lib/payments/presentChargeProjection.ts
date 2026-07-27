import type { ChargeProjection, PayoutModel } from '@/types';
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
 *
 * PAY MODE: `payoutModel` tells the Complete sheet which flow to render. In
 * `request` mode the cleaner's cut is OMITTED for cleaner viewers: the
 * percentage projection is not what they will be paid (they name their own
 * amount), so stating it would be wrong, not merely private. Org staff still
 * receive it because they author the counter-offer against it.
 */
export function presentChargeProjection(
  full: FullChargeBreakdown,
  opts: {
    display: 'full' | 'payout_only';
    isCleanerViewer: boolean;
    /** The assigned cleaner's pay mode; defaults to the percentage path. */
    payoutModel?: PayoutModel;
  },
): ChargeProjection {
  const payoutModel: PayoutModel = opts.payoutModel ?? 'percentage';
  const hideCut = payoutModel === 'request' && opts.isCleanerViewer;

  if (opts.display === 'payout_only' && opts.isCleanerViewer) {
    return {
      display: 'payout_only',
      payoutModel,
      ...(hideCut ? {} : { cleanerCutCents: full.cleanerCutCents }),
      isSelfPay: full.isSelfPay,
    };
  }
  return {
    display: 'full',
    payoutModel,
    ...(hideCut ? {} : { cleanerCutCents: full.cleanerCutCents }),
    isSelfPay: full.isSelfPay,
    baseCents: full.baseCents,
    method: full.method,
    chargeCents: full.chargeCents,
    feeCents: full.feeCents,
    platformFeeCents: full.platformFeeCents,
    payoutPercent: full.payoutPercent,
  };
}
