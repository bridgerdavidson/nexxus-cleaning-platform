/**
 * Self-pay money math.
 *
 * When an organization pays for a cleaning on its OWN property/card, the only
 * real money movement is org → cleaner. The org is charged the cleaner's cut
 * GROSSED UP for Stripe's processing fee so the cleaner nets their full %, and
 * 100% of the cut is transferred to the cleaner. There is no platform fee and no
 * tenant remainder (the org IS the tenant — it can't pay itself).
 *
 * Decisions baked in:
 *   - cleaner cut = % of the notional job GROSS, floored — identical basis to the
 *     normal split (reuses computePaymentSplit so the two paths never diverge).
 *   - the org card is charged ceil((cut + fixedFee) / (1 - percentFee)) so that,
 *     after Stripe takes its real fee, the platform balance nets AT LEAST the cut.
 *   - the cleaner is paid the EXACT cut; any residual cent from gross-up overshoot
 *     stays on the platform/org (never short the cleaner, never overpay them).
 *
 * All values are integer cents. Pure + dependency-light so it unit-tests in
 * isolation and a trimmed copy can drive the booking-modal "you'll be charged ≈ $X"
 * transparency panel.
 */
import { computePaymentSplit } from '@/lib/stripe/charges/splits';

/** Stripe US standard card pricing: 2.9% + 30¢. */
export const STRIPE_PERCENT_FEE = 0.029;
export const STRIPE_FIXED_FEE_CENTS = 30;

export interface SelfPayAmountsParams {
  /** The notional job price in cents — the basis for the cleaner's percentage. */
  jobGrossCents: number;
  /** Cleaner's percentage of the job gross, 0..100. */
  payoutPercent: number;
}

export interface SelfPayAmounts {
  jobGrossCents: number;
  payoutPercent: number;
  /** What the cleaner actually receives (paid exactly this). */
  cleanerCutCents: number;
  /** What the org's card is charged — the cut grossed up for Stripe's fee. */
  chargeCents: number;
  /** chargeCents − cleanerCutCents; the (estimated) Stripe overhead, for display. */
  estimatedFeeCents: number;
}

/**
 * Smallest integer charge whose Stripe-fee-net is ≥ `netCents`.
 * Inverts net = charge − (charge·percentFee + fixedFee). Ceil guarantees the
 * net never falls short of the target (the cleaner is always made whole).
 */
export function grossUpForStripeFee(netCents: number): number {
  if (!Number.isInteger(netCents) || netCents < 0) {
    throw new Error('grossUpForStripeFee: netCents must be a non-negative integer');
  }
  if (netCents === 0) return 0;
  return Math.ceil((netCents + STRIPE_FIXED_FEE_CENTS) / (1 - STRIPE_PERCENT_FEE));
}

export function computeSelfPayAmounts({ jobGrossCents, payoutPercent }: SelfPayAmountsParams): SelfPayAmounts {
  // Reuse the locked cleaner-cut math (% of gross, floored). platformFeeBps:0 is
  // irrelevant here — we only read cleanerCents — but keeps a single source of truth.
  const { cleanerCents } = computePaymentSplit({ grossCents: jobGrossCents, payoutPercent, platformFeeBps: 0 });
  const chargeCents = grossUpForStripeFee(cleanerCents);
  return {
    jobGrossCents,
    payoutPercent,
    cleanerCutCents: cleanerCents,
    chargeCents,
    estimatedFeeCents: chargeCents - cleanerCents,
  };
}
