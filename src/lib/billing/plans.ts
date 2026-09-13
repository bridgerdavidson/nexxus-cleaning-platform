// The single source of truth for SaaS plan pricing, importable from both server
// and client. src/components/marketing/pricing.ts re-exports from here so the
// pricing page and the billing engine cannot drift.
//
// Numbers mirror the locked brain doc
// ~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-pricing-decision.md
// plus its 2026-09-12 addendum. Change one only with a logged decision there.

export type PlanTier = 'starter' | 'growth' | 'pro';
export type BillingPeriod = 'monthly' | 'annual';

export interface PlanDefinition {
  name: string;
  /** Sticker price per month when billed monthly. */
  monthlyCents: number;
  /** Sticker price per month when billed annually (charged once a year as 12x this). */
  annualMonthlyCents: number;
  includedSeats: number;
  /** Hard cap on purchasable seats; null = no limit. */
  maxSeats: number | null;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  starter: { name: 'Starter', monthlyCents: 3900,  annualMonthlyCents: 2900,  includedSeats: 3,  maxSeats: 5 },
  growth:  { name: 'Growth',  monthlyCents: 9900,  annualMonthlyCents: 7900,  includedSeats: 8,  maxSeats: 15 },
  pro:     { name: 'Pro',     monthlyCents: 16900, annualMonthlyCents: 13900, includedSeats: 15, maxSeats: null },
};

export const PLAN_TIERS: PlanTier[] = ['starter', 'growth', 'pro'];

/** An extra cleaner seat, billed monthly. */
export const EXTRA_SEAT_MONTHLY_CENTS = 1000;
/** An extra cleaner seat, billed yearly. 12 x $10, no annual discount on seats. */
export const EXTRA_SEAT_ANNUAL_CENTS = 12000;

export const TRIAL_DAYS = 14;
export const TRIAL_EXTENSION_DAYS = 7;
/** Flat seat cap during a trial, regardless of which tier they end up buying. */
export const TRIAL_SEAT_CAP = 15;

/**
 * Eight Prices, not seven: Stripe requires every item on one subscription to
 * share a billing interval, so an annual subscription needs an annual seat Price.
 */
export const LOOKUP_KEYS = [
  'starter_monthly', 'starter_annual',
  'growth_monthly', 'growth_annual',
  'pro_monthly', 'pro_annual',
  'extra_seat_monthly', 'extra_seat_annual',
] as const;

export type LookupKey = (typeof LOOKUP_KEYS)[number];

/** The base Price lookup key for a tier at a billing period. */
export function lookupKeyFor(tier: PlanTier, period: BillingPeriod): LookupKey {
  return `${tier}_${period}` as LookupKey;
}

/** The extra-seat Price lookup key for a billing period. */
export function seatLookupKeyFor(period: BillingPeriod): LookupKey {
  return `extra_seat_${period}` as LookupKey;
}

/** The tier and period a base lookup key names, or null for a seat or unknown key. */
export function tierFor(lookupKey: string): { tier: PlanTier; period: BillingPeriod } | null {
  const match = /^(starter|growth|pro)_(monthly|annual)$/.exec(lookupKey);
  if (!match) return null;
  return { tier: match[1] as PlanTier, period: match[2] as BillingPeriod };
}

/** Purchasable seat range for a tier: [includedSeats, maxSeats]. */
export function seatBounds(tier: PlanTier): { min: number; max: number | null } {
  const plan = PLANS[tier];
  return { min: plan.includedSeats, max: plan.maxSeats };
}

/**
 * Display price per month: base plus one seat price for every seat above the
 * included count. Annual seats cost $120/yr, which is exactly $10/mo of display
 * value, so the monthly-equivalent arithmetic is the same for both periods.
 */
export function planMonthlyCents(tier: PlanTier, period: BillingPeriod, seatCount: number): number {
  const plan = PLANS[tier];
  const base = period === 'annual' ? plan.annualMonthlyCents : plan.monthlyCents;
  const extras = Math.max(0, seatCount - plan.includedSeats);
  const seatMonthly = period === 'annual' ? EXTRA_SEAT_ANNUAL_CENTS / 12 : EXTRA_SEAT_MONTHLY_CENTS;
  return base + extras * seatMonthly;
}

/** What Stripe actually charges per billing cycle: 12x the monthly view for annual. */
export function planChargeCents(tier: PlanTier, period: BillingPeriod, seatCount: number): number {
  const monthly = planMonthlyCents(tier, period, seatCount);
  return period === 'annual' ? monthly * 12 : monthly;
}
