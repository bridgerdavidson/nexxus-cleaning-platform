// The marketing page's dollar-shaped view of the plan catalog. The numbers live
// in src/lib/billing/plans.ts (cents) so the pricing page and the billing engine
// cannot drift; this file only reshapes them and carries the marketing copy.

import {
  EXTRA_SEAT_MONTHLY_CENTS,
  PLANS,
  type PlanTier,
} from '@/lib/billing/plans';

export type BillingPeriod = 'annual' | 'monthly'

export interface PricingTier {
  name: string
  blurb: string
  /** Per-month sticker price at each billing period. */
  bases: Record<BillingPeriod, number>
  includedSeats: number
  /** Hard seat cap before an upgrade is required; null = unlimited. */
  cap: number | null
  /** Tier name shown in the over-cap state ("Needs Growth"). */
  capNeeds: string | null
  features: string[]
  popular?: boolean
}

export const EXTRA_SEAT_PRICE = EXTRA_SEAT_MONTHLY_CENTS / 100

const COPY: Record<PlanTier, { blurb: string; capNeeds: string | null; features: string[]; popular?: boolean }> = {
  starter: {
    blurb: 'For solo operators and first hires.',
    capNeeds: 'Growth',
    features: [
      'The whole core product, no feature strip-down',
      'Online booking and scheduling, including recurring visits',
      'Homeowner and cleaner apps',
      'Card payments with automatic cleaner payouts',
      'In-app messaging and notifications',
      'Your own branding on everything (white-label)',
      'Standard support',
    ],
  },
  growth: {
    blurb: 'For companies ready to stop doing office work at night.',
    capNeeds: 'Pro',
    popular: true,
    features: [
      'Everything in Starter',
      'ACH payments (0.8% capped at $5, at cost)',
      'Cancellation and no-show fee tooling',
      'Analytics dashboard',
      'Priority support',
      'New features land here first',
    ],
  },
  pro: {
    blurb: 'For established crews with managers and payroll.',
    capNeeds: null,
    // "Unlimited cleaner seats" becomes "No seat limit" (pricing doc addendum 2026-09-12).
    features: [
      'Everything in Growth',
      'No seat limit',
      'White-glove onboarding',
      'Free data migration',
      'First access to AI features as they ship',
    ],
  },
}

function toTier(tier: PlanTier): PricingTier {
  const plan = PLANS[tier]
  const copy = COPY[tier]
  return {
    name: plan.name,
    blurb: copy.blurb,
    bases: { annual: plan.annualMonthlyCents / 100, monthly: plan.monthlyCents / 100 },
    includedSeats: plan.includedSeats,
    cap: plan.maxSeats,
    capNeeds: copy.capNeeds,
    features: copy.features,
    ...(copy.popular ? { popular: true } : {}),
  }
}

export const PRICING_TIERS: PricingTier[] = [toTier('starter'), toTier('growth'), toTier('pro')]

export function tierTotal(tier: PricingTier, period: BillingPeriod, cleaners: number): number {
  return tier.bases[period] + Math.max(0, cleaners - tier.includedSeats) * EXTRA_SEAT_PRICE
}

export function overCap(tier: PricingTier, cleaners: number): boolean {
  return tier.cap != null && cleaners > tier.cap
}
