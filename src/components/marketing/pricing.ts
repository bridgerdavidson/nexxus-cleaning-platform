// Pricing source of truth: the brain doc
// ~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-pricing-decision.md
// (locked 2026-07-26). Numbers here mirror it; change them only with a logged
// decision there. Annual is the default display ("billed annually").

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

export const EXTRA_SEAT_PRICE = 10

export const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Starter',
    blurb: 'For solo operators and first hires.',
    bases: { annual: 29, monthly: 39 },
    includedSeats: 3,
    cap: 5,
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
  {
    name: 'Growth',
    blurb: 'For companies ready to stop doing office work at night.',
    bases: { annual: 79, monthly: 99 },
    includedSeats: 8,
    cap: 15,
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
  {
    name: 'Pro',
    blurb: 'For established crews with managers and payroll.',
    bases: { annual: 139, monthly: 169 },
    includedSeats: 15,
    cap: null,
    capNeeds: null,
    features: [
      'Everything in Growth',
      'Unlimited cleaner seats',
      'White-glove onboarding',
      'Free data migration',
      'First access to AI features as they ship',
    ],
  },
]

export function tierTotal(tier: PricingTier, period: BillingPeriod, cleaners: number): number {
  return tier.bases[period] + Math.max(0, cleaners - tier.includedSeats) * EXTRA_SEAT_PRICE
}

export function overCap(tier: PricingTier, cleaners: number): boolean {
  return tier.cap != null && cleaners > tier.cap
}
