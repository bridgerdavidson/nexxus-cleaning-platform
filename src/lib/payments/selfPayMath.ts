/**
 * Self-pay money math.
 *
 * When an organization pays for a cleaning on its OWN property/card, the real money
 * movement is org → cleaner, plus the platform's per-appointment fee. The org is
 * charged the cleaner's cut PLUS the platform fee, GROSSED UP for Stripe's processing
 * fee, so the cleaner nets their full % and the platform nets its fee. Only the
 * cleaner's exact cut is transferred out; the platform fee (and any gross-up
 * overshoot) stays on the platform balance. There is no tenant remainder (the org IS
 * the tenant — it can't pay itself).
 *
 * Decisions baked in:
 *   - cleaner cut = % of the notional job GROSS, floored — identical basis to the
 *     normal split (reuses computePaymentSplit so the two paths never diverge).
 *   - platform fee = platformFeeBps of the notional job GROSS (same basis as the
 *     homeowner path, so the platform earns the same on a job no matter who pays).
 *     Unlike the homeowner path it is NOT capped at a remainder: the org is the payer,
 *     so the fee rides on top of the cut (a 100%-payout cleaner still yields the fee).
 *   - the org card is charged ceil((cut + fee + fixedFee) / (1 - percentFee)) so that,
 *     after Stripe takes its real fee, the platform balance nets AT LEAST cut + fee.
 *   - the cleaner is paid the EXACT cut; the platform fee and any residual cent from
 *     gross-up overshoot stay on the platform (never short the cleaner, never overpay).
 *   - a zero cleaner cut charges nothing at all (no job money movement → no fee).
 *
 * All values are integer cents. Pure + dependency-light so it unit-tests in
 * isolation and a trimmed copy can drive the booking-modal "you'll be charged ≈ $X"
 * transparency panel.
 */
import { computePaymentSplit, platformFeeCentsFor } from '@/lib/stripe/charges/splits';
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
   * Platform fee in basis points of the job gross, 0..10000 (100 = 1%). Defaults to 0;
   * charge paths pass the org's `platform_fee_bps`.
   */
  platformFeeBps?: number;
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
  /** The platform's per-appointment fee, retained on the platform balance. */
  platformFeeCents: number;
  /** What the org's card is charged — cut + platform fee, grossed up for Stripe's fee. */
  chargeCents: number;
  /** chargeCents − cut − platform fee; the (estimated) Stripe overhead, for display. */
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
  platformFeeBps = 0,
  method = 'card',
}: SelfPayAmountsParams): SelfPayAmounts {
  // Reuse the locked cleaner-cut math (% of gross, floored). platformFeeBps:0 here on purpose —
  // the homeowner split caps the fee at the tenant remainder, but self-pay has no remainder, so
  // we only read cleanerCents and derive the UNCAPPED fee below (single formula, different cap).
  const { cleanerCents } = computePaymentSplit({ grossCents: jobGrossCents, payoutPercent, platformFeeBps: 0 });
  return {
    ...computeSelfPayAmountsFromCents({ jobGrossCents, cleanerCutCents: cleanerCents, platformFeeBps, method }),
    payoutPercent,
  };
}

export interface SelfPayAmountsFromCentsParams {
  jobGrossCents: number;
  /** The cleaner's already-resolved cut in cents (flat rate or approved pay request). */
  cleanerCutCents: number;
  platformFeeBps?: number;
  method?: PaymentMethodKind;
}

/**
 * The cents-based sibling of computeSelfPayAmounts for pay modes whose cleaner
 * cut is an absolute amount (flat / request). Identical fee + gross-up rules:
 * the platform fee is bps of the notional job GROSS (same basis regardless of
 * who pays or how the cut was set), a zero cut charges nothing at all, and the
 * charge is cut + fee grossed up for the method's Stripe fee.
 */
export function computeSelfPayAmountsFromCents({
  jobGrossCents,
  cleanerCutCents,
  platformFeeBps = 0,
  method = 'card',
}: SelfPayAmountsFromCentsParams): SelfPayAmounts {
  if (!Number.isInteger(cleanerCutCents) || cleanerCutCents < 0) {
    throw new Error('computeSelfPayAmountsFromCents: cleanerCutCents must be a non-negative integer');
  }
  // Always derive (validates bps even on a zero cut); a zero cut then zeroes the fee.
  const rawPlatformFeeCents = platformFeeCentsFor(jobGrossCents, platformFeeBps);
  const platformFeeCents = cleanerCutCents > 0 ? rawPlatformFeeCents : 0;
  // Gross up cut + fee for the chosen method's real Stripe fee so the platform nets ≥ both.
  const chargeCents = grossUpForFee(method, cleanerCutCents + platformFeeCents);
  return {
    jobGrossCents,
    payoutPercent: 0,
    cleanerCutCents,
    platformFeeCents,
    chargeCents,
    estimatedFeeCents: chargeCents - cleanerCutCents - platformFeeCents,
  };
}
