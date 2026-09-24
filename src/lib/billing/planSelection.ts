// The {tier, period, seat_count} triple both purchase routes take, and the two
// rules that decide whether it is buyable. Shared so POST /api/billing/checkout
// and POST /api/billing/plan can never drift on what a legal plan is, or on the
// wording an operator sees when it is not.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §15.

import { PLANS, seatBounds, type BillingPeriod, type PlanTier } from './plans';

export interface PlanSelection {
  tier: PlanTier;
  period: BillingPeriod;
  seatCount: number;
}

export type PlanSelectionResult =
  | { ok: true; selection: PlanSelection }
  | { ok: false; error: string };

const TIERS: PlanTier[] = ['starter', 'growth', 'pro'];
const PERIODS: BillingPeriod[] = ['monthly', 'annual'];

/**
 * Shape only: the tier and period are known values and the seat count is a whole
 * number. Runs BEFORE the auth check, like every other request-shape check, so a
 * malformed body is a 400 rather than a 401 that hides the real problem.
 */
export function parsePlanSelection(body: Record<string, unknown> | null | undefined): PlanSelectionResult {
  const tier = body?.tier;
  const period = body?.period;
  const seatCount = body?.seat_count;

  if (typeof tier !== 'string' || !TIERS.includes(tier as PlanTier)) {
    return { ok: false, error: 'Choose a plan tier of starter, growth, or pro.' };
  }
  if (typeof period !== 'string' || !PERIODS.includes(period as BillingPeriod)) {
    return { ok: false, error: 'Choose a billing period of monthly or annual.' };
  }
  if (typeof seatCount !== 'number' || !Number.isInteger(seatCount)) {
    return { ok: false, error: 'seat_count must be a whole number.' };
  }

  return {
    ok: true,
    selection: { tier: tier as PlanTier, period: period as BillingPeriod, seatCount },
  };
}

/**
 * How stale a client-supplied `proration_date` may be, in seconds.
 *
 * Long enough for a person to read the quote and press the button, short enough
 * that the instant is still meaningfully "the same moment" as the preview.
 */
export const PRORATION_DATE_MAX_AGE_S = 600;

/** A little slack for clock skew between the client's quote and this server. */
const PRORATION_DATE_MAX_SKEW_S = 60;

/**
 * The `proration_date` the client echoes back from the quote it was shown, or
 * null to let Stripe prorate at its own instant.
 *
 * Stripe prorates to the second, so passing the preview's instant on the update
 * is what makes "the number shown is the number charged" literally true rather
 * than approximately true (Stripe's prorations guide asks for exactly this).
 *
 * A value outside the window is IGNORED rather than refused. It is a precision
 * hint, not part of the purchase: a customer who left the tab open should get
 * the change they asked for, priced at now, not a 400 they cannot act on. And
 * ignoring is the safe direction, because it is the behaviour this route had
 * before the field existed.
 */
export function parseProrationDate(
  body: Record<string, unknown> | null | undefined,
  nowSeconds: number,
): number | null {
  const value = body?.proration_date;
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value > nowSeconds + PRORATION_DATE_MAX_SKEW_S) return null;
  if (value < nowSeconds - PRORATION_DATE_MAX_AGE_S) return null;
  return value;
}

/** The tier's own purchasable range. Null when the count is inside it. */
export function seatBoundsError(tier: PlanTier, seatCount: number): string | null {
  const bounds = seatBounds(tier);
  if (seatCount < bounds.min) {
    return `${PLANS[tier].name} includes ${bounds.min} seats, so buy at least ${bounds.min}.`;
  }
  if (bounds.max != null && seatCount > bounds.max) {
    return `${PLANS[tier].name} allows at most ${bounds.max} seats. Choose a larger plan.`;
  }
  return null;
}

/**
 * Cleaners already in the organization set a floor under what may be bought.
 * This is the rule that steers an over-cap formerly-comped org to a tier that
 * fits, so the seat count that feeds it must never be a failed-open guess.
 */
export function seatsInUseError(seatCount: number, seatsInUse: number): string | null {
  if (seatCount < seatsInUse) {
    return `You have ${seatsInUse} cleaners, so buy at least ${seatsInUse} seats.`;
  }
  return null;
}
