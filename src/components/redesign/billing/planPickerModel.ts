// Every decision PlanPicker makes, as pure functions.
//
// This split is not stylistic. There is no component-rendering test setup in
// this repo, so anything that lives inside the .tsx is untested by
// construction. The defaults that money hangs on (ruling R4's monthly period,
// ruling R5's pre-selected tier, ruling R21's direction-driven total label,
// ruling R11's cancel note) therefore live HERE, where a mutation test can
// reach them. The component must call these rather than restate the rule.
//
// Copy builders return finished strings so the wording itself is under test
// (the no-em-dash rule, R11, R21). Money is integer cents up to the moment a
// string is built; nothing here does arithmetic on a formatted value.

import {
  PLANS,
  PLAN_TIERS,
  EXTRA_SEAT_ANNUAL_CENTS,
  EXTRA_SEAT_MONTHLY_CENTS,
  type BillingPeriod,
  type PlanTier,
} from '@/lib/billing/plans'
import { formatBillingDate, formatCents } from '@/lib/billing/format'
import type { PlanPreviewPayload } from '@/app/api/billing/plan/preview/route'

export interface TierOption {
  tier: PlanTier
  name: string
  /** Per-month price at the selected period, in cents. */
  priceCents: number
  includedSeats: number
  maxSeats: number | null
  available: boolean
  /** Ruling R6: greyed tiers state WHY, inline. */
  unavailableReason?: string
  /** Ruling R5: factual, computed from their real headcount. Never promotional. */
  fitReason?: string
}

function cleaners(n: number): string {
  return n === 1 ? '1 cleaner' : `${n} cleaners`
}

function fitsHeadcount(tier: PlanTier, seatsInUse: number): boolean {
  const max = PLANS[tier].maxSeats
  return max === null || seatsInUse <= max
}

/** The smallest tier whose max seats can hold the current headcount. */
export function defaultTierFor(seatsInUse: number, currentTier: PlanTier | null): PlanTier {
  if (currentTier && fitsHeadcount(currentTier, seatsInUse)) return currentTier
  return PLAN_TIERS.find((t) => fitsHeadcount(t, seatsInUse)) ?? 'pro'
}

export function buildTierOptions(args: {
  period: BillingPeriod
  seatsInUse: number
  currentTier: PlanTier | null
}): TierOption[] {
  const { period, seatsInUse, currentTier } = args
  const preselected = defaultTierFor(seatsInUse, currentTier)

  return PLAN_TIERS.map((tier) => {
    const plan = PLANS[tier]
    const available = fitsHeadcount(tier, seatsInUse)
    // An org with nobody on the team yet has no headcount fact to state, and
    // "Fits your 0 cleaners" is not one. Pre-selection still happens; only the
    // label is withheld, because ruling R5 allows a fact and nothing else.
    const statesFit = tier === preselected && seatsInUse > 0
    return {
      tier,
      name: plan.name,
      priceCents: period === 'annual' ? plan.annualMonthlyCents : plan.monthlyCents,
      includedSeats: plan.includedSeats,
      maxSeats: plan.maxSeats,
      available,
      unavailableReason: available ? undefined : `Too small for your ${cleaners(seatsInUse)}`,
      fitReason: statesFit ? `Fits your ${cleaners(seatsInUse)}` : undefined,
    }
  })
}

/**
 * You may never buy fewer seats than you have people, and never fewer than the
 * tier includes (buying below the included count saves nothing).
 */
export function seatFloorFor(tier: PlanTier, seatsInUse: number): number {
  return Math.max(PLANS[tier].includedSeats, seatsInUse)
}

/**
 * Seat count held inside the selected tier's purchasable range. The floor wins
 * over the requested value; the cap wins over the floor only on a tier the
 * headcount does not fit, which the UI never lets anyone select.
 */
export function clampSeats(args: {
  tier: PlanTier
  seatsInUse: number
  desired: number
}): number {
  const { tier, seatsInUse, desired } = args
  const atLeast = Math.max(seatFloorFor(tier, seatsInUse), desired)
  const max = PLANS[tier].maxSeats
  return max === null ? atLeast : Math.min(atLeast, max)
}

/** Opening seat count: what they already pay for, never below the floor. */
export function initialSeatsFor(args: {
  tier: PlanTier
  seatsInUse: number
  currentSeats: number | null
}): number {
  return clampSeats({
    tier: args.tier,
    seatsInUse: args.seatsInUse,
    desired: args.currentSeats ?? 0,
  })
}

/**
 * Ruling R4. Monthly unless they are already paying annually. Defaulting a
 * price-sensitive small business into the larger charge is the surprise pattern
 * the ruling exists to refuse, so this never reads 'annual' out of thin air.
 */
export function initialPeriodFor(currentPeriod: BillingPeriod | null): BillingPeriod {
  return currentPeriod ?? 'monthly'
}

/** Plain-English name for the billing cadence, as it reads inside a sentence. */
function periodWord(period: BillingPeriod): string {
  return period === 'annual' ? 'yearly' : 'monthly'
}

export interface PlanLine {
  label: string
  cents: number
}

/**
 * The itemisation above the total (ruling R7). These are catalogue prices for a
 * full period, so base + seats is exactly planChargeCents for the selection.
 * They describe the PLAN. The total beneath them comes from the preview
 * endpoint and may legitimately differ (proration, credits, coupons, tax),
 * which is what prorationNoteFor exists to explain.
 */
export function planLines(args: {
  tier: PlanTier
  period: BillingPeriod
  seatCount: number
}): { base: PlanLine; seats: PlanLine } {
  const { tier, period, seatCount } = args
  const plan = PLANS[tier]
  const annual = period === 'annual'
  const baseCents = annual ? plan.annualMonthlyCents * 12 : plan.monthlyCents
  const extras = Math.max(0, seatCount - plan.includedSeats)
  const perSeat = annual ? EXTRA_SEAT_ANNUAL_CENTS : EXTRA_SEAT_MONTHLY_CENTS
  return {
    base: { label: `${plan.name}, ${periodWord(period)}`, cents: baseCents },
    seats: {
      label: `${seatCount} seats, ${plan.includedSeats} included`,
      cents: extras * perSeat,
    },
  }
}

export interface TotalRow {
  label: string
  /** null means show no figure at all, not zero. */
  cents: number | null
}

/**
 * Ruling R21. The label is driven by the preview's own direction, because PR E
 * only invoices an upgrade immediately; a downgrade bills nothing now and lands
 * as credit. A blanket "Due today" is wrong half the time, and a wrong money
 * label at the confirm step is the exact surprise ruling R8 forbids.
 */
export function totalRowFor(preview: PlanPreviewPayload): TotalRow {
  switch (preview.direction) {
    case 'downgrade':
      return { label: 'Credited to your next invoice', cents: preview.recurring_cents }
    case 'unchanged':
      return { label: 'Your bill does not change', cents: null }
    default:
      return { label: 'Charged today', cents: preview.due_now_cents }
  }
}

/**
 * The line under the total. It reconciles the figure above with what happens
 * next, and is the only place a date is stated, so the two can never disagree.
 */
export function renewalNoteFor(args: {
  preview: PlanPreviewPayload
  period: BillingPeriod
}): string {
  const { preview, period } = args
  // formatBillingDate returns '' for null and for an unparseable value, so an
  // empty string is the single "no usable date" signal.
  const date = formatBillingDate(preview.next_charge_at)
  const amount = formatCents(preview.recurring_cents)

  if (preview.direction === 'downgrade') {
    return date
      ? `Nothing is charged today. Your plan changes to this price on ${date}.`
      : 'Nothing is charged today. Your plan changes to this price on your next invoice.'
  }
  return date ? `Then ${amount} on ${date}.` : `Then ${amount} every ${period === 'annual' ? 'year' : 'month'}.`
}

/** Ruling R11. It would be misleading on an annual commitment. */
export function cancelNoteFor(period: BillingPeriod): string | null {
  return period === 'monthly' ? 'Cancel anytime.' : null
}

/**
 * Ruling R8's honesty valve. When the tax flag is off the quote is short of
 * what Stripe will take, so the summary says so rather than implying the total
 * is final.
 */
export function taxNoteFor(preview: PlanPreviewPayload): string | null {
  return preview.tax_excluded ? 'Sales tax is calculated at checkout.' : null
}

/**
 * An upgrade on a live subscription is charged a PART period, so the total will
 * not match the itemised full-period lines above it. Say why, or the mismatch
 * reads as a bug in our arithmetic.
 */
export function prorationNoteFor(preview: PlanPreviewPayload): string | null {
  if (preview.direction !== 'upgrade' || preview.is_new_subscription) return null
  return "Today's amount covers the rest of your current billing period."
}

export function seatHelperText(seatsInUse: number, includedSeats: number): string {
  return `${seatsInUse} in use, ${includedSeats} included at no extra cost`
}

/** Why the stepper refuses to go lower, shown at the floor. */
export function seatMinReasonFor(tier: PlanTier, seatsInUse: number): string {
  const plan = PLANS[tier]
  return seatsInUse > plan.includedSeats
    ? `You have ${cleaners(seatsInUse)} on your team.`
    : `${plan.name} includes ${plan.includedSeats} seats.`
}

/** Purchasable seat range for the selected tier, as the Stepper takes it. */
export function seatRangeFor(
  tier: PlanTier,
  seatsInUse: number,
): { min: number; max: number | null } {
  return { min: seatFloorFor(tier, seatsInUse), max: PLANS[tier].maxSeats }
}

export interface QuoteState {
  /** 'pending' means show a skeleton. It NEVER means show the last number. */
  status: 'pending' | 'error' | 'ready'
  /** Non-null only when it describes the selection currently on screen. */
  preview: PlanPreviewPayload | null
  canSubmit: boolean
}

/**
 * THE rule this component exists to keep, in one testable place: never show a
 * number we are not certain of, and never let anyone buy at an unknown price.
 *
 * The seat stepper is debounced, so between a click and the request there is a
 * window where the last quote describes a DIFFERENT seat count than the one on
 * screen. Rendering it there is how a customer is shown $99.00 and charged
 * $109.00. `pricedSeats` is the count the quote was asked about; until it
 * matches, and until the request settles, the answer is 'pending' and the only
 * honest thing to draw is a skeleton.
 */
export function quoteStateFor(args: {
  seats: number
  pricedSeats: number
  isFetching: boolean
  error: unknown
  data: PlanPreviewPayload | null | undefined
  submitting: boolean
}): QuoteState {
  const settled = args.seats === args.pricedSeats && !args.isFetching
  if (!settled) return { status: 'pending', preview: null, canSubmit: false }
  if (args.error) return { status: 'error', preview: null, canSubmit: false }
  if (!args.data) return { status: 'pending', preview: null, canSubmit: false }
  return { status: 'ready', preview: args.data, canSubmit: !args.submitting }
}
