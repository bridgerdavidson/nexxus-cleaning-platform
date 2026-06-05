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
import { FEE_SCHEDULES, grossUpForFee, type PaymentMethodKind } from './processingFee';

/** Stripe US standard card pricing: 2.9% + 30¢ (single source: processingFee). */
export const STRIPE_PERCENT_FEE = FEE_SCHEDULES.card.percent;
export const STRIPE_FIXED_FEE_CENTS = FEE_SCHEDULES.card.fixedCents;

export interface SelfPayAmountsParams {
  /** The notional job price in cents — the basis for the cleaner's percentage. */
  jobGrossCents: number;
  /** Cleaner's percentage of the job gross, 0..100. */
  payoutPercent: number;
  /**
   * How the org pays. Only the gross-up (fee) depends on it — the cleaner's cut is identical
   * either way. Bank (us_bank_account) is far cheaper (0.8% capped $5 vs card 2.9% + 30¢).
   * Defaults to card (the costlier fee — never under-quote the charge).
   */
  method?: PaymentMethodKind;
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
  // Card gross-up; delegates to the method-aware module so there is one implementation.
  return grossUpForFee('card', netCents);
}

export function computeSelfPayAmounts({
  jobGrossCents,
  payoutPercent,
  method = 'card',
}: SelfPayAmountsParams): SelfPayAmounts {
  // Reuse the locked cleaner-cut math (% of gross, floored). platformFeeBps:0 is
  // irrelevant here — we only read cleanerCents — but keeps a single source of truth.
  const { cleanerCents } = computePaymentSplit({ grossCents: jobGrossCents, payoutPercent, platformFeeBps: 0 });
  // Gross up the cut for the chosen method's real Stripe fee so the platform nets ≥ the cut.
  const chargeCents = grossUpForFee(method, cleanerCents);
  return {
    jobGrossCents,
    payoutPercent,
    cleanerCutCents: cleanerCents,
    chargeCents,
    estimatedFeeCents: chargeCents - cleanerCents,
  };
}
