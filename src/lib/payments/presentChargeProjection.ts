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
 * PAY MODE: `payoutModel` tells the Complete sheet which flow to render, and
 * decides what a CLEANER viewer may be told about the money:
 *
 * - `request`: the cut is omitted (they name their own amount, so a
 *   percentage projection is simply not their pay), AND the customer-charge
 *   fields are stripped regardless of the org's `cleaner_pay_display`. Hiding
 *   the job price is intrinsic to this pay model, not an org preference: a
 *   cleaner who can see the price can compute the auto-approve cap and always
 *   ask one cent under it, which is the behavior the model exists to prevent.
 * - `flat`: the cut is omitted too. Their pay is min(flat_rate, gross), which
 *   this function has no flat_rate to compute, so the percentage-derived
 *   number would be a wrong figure presented as their earnings.
 *
 * Org staff (never `isCleanerViewer`) always receive the full breakdown; they
 * author offers against it.
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
  const hideCut =
    opts.isCleanerViewer && (payoutModel === 'request' || payoutModel === 'flat');
  // Request mode forces the price-free shape even when the org displays 'full'.
  const priceSealed = opts.isCleanerViewer && payoutModel === 'request';

  if ((opts.display === 'payout_only' && opts.isCleanerViewer) || priceSealed) {
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
