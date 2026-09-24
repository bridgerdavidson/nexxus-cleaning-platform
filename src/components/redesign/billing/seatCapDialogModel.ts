// Every decision SeatCapDialog makes, as pure functions.
//
// Same reason as planPickerModel.ts and billingSectionModel.ts: this repo has
// no component-rendering setup and @testing-library/react is not installed, so
// a rule left inside the .tsx is a rule with no coverage. The rules that money
// and permission hang on therefore live HERE, where a mutation test can reach
// them:
//
//   1. CASE 0 IS CHECKED FIRST. An org on a trial has plan_tier == null and a
//      flat 15-seat cap, which is a real, reachable state (a trialing org is
//      not frozen, so it passes assertOrgWritable and really does receive the
//      409). Both priced cases dereference PLANS[tier], and PLANS[null] is
//      undefined, so checking them first turns that org's seat cap into a
//      TypeError instead of a dialog.
//   2. A NON-OWNER NEVER SEES A PRICE. The non-owner case carries no
//      `selection` and no cents field of any kind, so there is no number for a
//      renderer to draw and no selection for it to price. Adding a seat is a
//      purchase (ruling R15 v4), and quoting a price to someone who cannot buy
//      it is the dead control ruling R2 exists to prevent.
//   3. NO TOTAL IS COMPUTED HERE. A priced case carries a total LABEL and the
//      catalogue lines above it, never a total figure. The figure comes from
//      the preview endpoint (seatCapTotalRow), which asks Stripe. A locally
//      computed total is exactly how a customer is shown one number and
//      charged another, which is the failure the preview endpoint exists to
//      prevent.
//
// Reference: .superpowers/sdd/2026-09-21-phase1f-billing-ui/task-10-brief.md
// (rulings R7, R15 v4, R16, R17, R21 v2).

import type { PlanPreviewPayload } from '@/app/api/billing/plan/preview/route'
import type { BillingAccess } from '@/lib/billing/access'
import { formatBillingDate, formatCents } from '@/lib/billing/format'
import {
  EXTRA_SEAT_ANNUAL_CENTS,
  EXTRA_SEAT_MONTHLY_CENTS,
  PLANS,
  PLAN_TIERS,
  planChargeCents,
  type BillingPeriod,
  type PlanTier,
} from '@/lib/billing/plans'
import { nextTierFor } from '@/lib/billing/seats'
import type { PlanSelectionBody } from './billing-api'

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** How the cadence reads inside a sentence. */
function periodWord(period: BillingPeriod): string {
  return period === 'annual' ? 'year' : 'month'
}

/** The extra-seat price for one seat, for one billing period, in cents. */
export function seatPriceCents(period: BillingPeriod): number {
  return period === 'annual' ? EXTRA_SEAT_ANNUAL_CENTS : EXTRA_SEAT_MONTHLY_CENTS
}

/**
 * nextTierFor returns a plan NAME ("Growth"), not a tier key, because it feeds
 * copy on the server. The dialog needs the key to build a selection, so this
 * resolves it back through the same PLANS table rather than lower-casing the
 * name and hoping.
 */
export function tierByName(name: string | null): PlanTier | null {
  if (!name) return null
  return PLAN_TIERS.find((t) => PLANS[t].name === name) ?? null
}

/**
 * How many seats the org must own for this invite to go through.
 *
 * One more than they own is the normal answer. The other two floors are real:
 * seats can be OVER-occupied (the send-invite route deliberately fails open on
 * a failed seat count, and the spec accepts an over-cap race), and a seat
 * count below the tier's included count would be rejected by the same
 * seatBoundsError the preview and apply routes share. Quoting a number either
 * route would refuse is worse than quoting a slightly larger one.
 */
export function targetSeatsFor(tier: PlanTier, seatCount: number, seatsInUse: number): number {
  return Math.max(seatCount + 1, seatsInUse + 1, PLANS[tier].includedSeats)
}

// ---------------------------------------------------------------------------
// The case
// ---------------------------------------------------------------------------

export interface SeatCapLine {
  label: string
  /** Catalogue cents for a full billing period. Describes the PLAN, not the invoice. */
  cents: number
}

interface SeatCapCopy {
  title: string
  body: string
}

export interface PricedSeatCapCase extends SeatCapCopy {
  cancelLabel: string
  confirmLabel: string
  /**
   * Priced AND submitted, as ONE object. The quote can therefore never
   * describe a different purchase than the confirm button applies.
   */
  selection: PlanSelectionBody
  /** The itemisation above the total (ruling R7). Catalogue prices. */
  lines: SeatCapLine[]
  /**
   * Label for the prominent total (ruling R17: the NEW total, never a delta).
   * The cents that go with it come from the preview, never from here.
   */
  totalLabel: string
  /** Plan-to-plan price comparison, both sides catalogue. Null when there is none. */
  comparison: string | null
}

export type SeatCapCase =
  /** The dialog cannot render: the UI flag is dark, or billing state is unreadable. */
  | { kind: 'unavailable' }
  | (SeatCapCopy & { kind: 'non_owner'; closeLabel: string })
  | (SeatCapCopy & { kind: 'trial'; cancelLabel: string; confirmLabel: string })
  | (PricedSeatCapCase & { kind: 'add_seat' })
  | (PricedSeatCapCase & { kind: 'upgrade' })

export interface SeatCapInput {
  /** NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED, via useBilling. */
  uiEnabled: boolean
  /** Null while loading or on a 403. */
  access: BillingAccess | null
  isOwner: boolean
  /** organizations.plan_tier, already narrowed by asPlanTier. Null on a trial. */
  tier: PlanTier | null
  /** organizations.seat_count: seats PURCHASED, not seats used. */
  seatCount: number | null
  /** Cleaner members plus pending cleaner invites. */
  seatsInUse: number
  /** organizations.billing_period, already narrowed by asBillingPeriod. */
  period: BillingPeriod | null
  /** The person they were trying to invite. Email in practice. */
  inviteeName: string | null
}

function who(inviteeName: string | null): string {
  return inviteeName ?? 'anyone else'
}

function seatWord(n: number): string {
  return n === 1 ? 'seat' : 'seats'
}

/**
 * Case A, built once. Case B's unreachable fallback renders the same thing, so
 * a change to the priced copy cannot apply to one of them and not the other.
 */
function addSeatCase(args: {
  tier: PlanTier
  period: BillingPeriod
  /** Seats the org already owns. */
  owned: number
  /** Seats it must own for this invite. */
  target: number
  inviteeName: string | null
}): SeatCapCase {
  const { tier, period, owned, target, inviteeName } = args
  const plan = PLANS[tier]
  const added = Math.max(1, target - owned)
  const perSeat = seatPriceCents(period)
  return {
    kind: 'add_seat',
    title: inviteeName ? `Add a seat to invite ${inviteeName}?` : 'Add a seat?',
    body:
      added === 1
        ? `All ${owned} of your seats are in use. One more seat is ${formatCents(perSeat)} a ${periodWord(period)}.`
        : `All ${owned} of your seats are in use. ${added} more seats are ${formatCents(perSeat)} a ${periodWord(period)} each.`,
    selection: { tier, period, seat_count: target },
    lines: [
      { label: `${plan.name}, ${owned} ${seatWord(owned)}`, cents: planChargeCents(tier, period, owned) },
      { label: `${added} extra ${seatWord(added)}`, cents: added * perSeat },
    ],
    totalLabel: totalLabelFor(period),
    comparison: null,
    cancelLabel: 'Cancel',
    confirmLabel: added === 1 ? 'Add seat and invite' : 'Add seats and invite',
  }
}

export function seatCapCaseFor(input: SeatCapInput): SeatCapCase {
  const { uiEnabled, access, isOwner, tier, seatCount, seatsInUse, inviteeName } = input

  // Flag-dark, still loading, or comped (a null cap means unlimited, so the
  // 409 that opens this dialog cannot have come from a comped org).
  if (!uiEnabled || !access || access.seatCap == null) return { kind: 'unavailable' }
  const cap = access.seatCap

  // Ruling R16 / R15 v4. Before any pricing exists, and before any tier is
  // read: a non-owner is told what to do, shown no money, and given nothing to
  // click but Close.
  if (!isOwner) {
    return {
      kind: 'non_owner',
      title: 'No seats available',
      body: `All ${cap} seats are in use. Ask your account owner to add a seat before inviting ${who(inviteeName)}.`,
      closeLabel: 'Close',
    }
  }

  // CASE 0, FIRST. Everything below this line dereferences PLANS[tier].
  // asPlanTier has already turned any unrecognised value into null, so an
  // unknown tier lands here too rather than in a priced case built on nothing.
  if (tier == null) {
    return {
      kind: 'trial',
      title: `You have used all ${cap} trial seats`,
      body: `Your trial includes ${cap} cleaner seats and all ${cap} are in use. Choose a plan to add more.`,
      cancelLabel: 'Not now',
      confirmLabel: 'Choose a plan',
    }
  }

  const period: BillingPeriod = input.period ?? 'monthly'
  const plan = PLANS[tier]
  // seat_count is written alongside plan_tier at checkout, so a tier with no
  // seat count is drift rather than a real state. deriveBillingAccess already
  // falls back the same way (seatCap = seat_count ?? TRIAL_SEAT_CAP), and the
  // preview endpoint arbitrates the money either way.
  const owned = seatCount ?? cap
  const target = targetSeatsFor(tier, owned, seatsInUse)

  // CASE A: the tier can hold the seat. Pro's maxSeats is null (no ceiling),
  // so Pro always lands here and Case B is structurally unreachable for it.
  if (plan.maxSeats == null || target <= plan.maxSeats) {
    return addSeatCase({ tier, period, owned, target, inviteeName })
  }

  // CASE B: the tier is full, so no seat can be bought inside it. nextTierFor
  // answers "which tier holds one more than they have", by NAME.
  const nextTier = tierByName(nextTierFor(seatsInUse, tier))
  if (!nextTier) {
    // Unreachable: the only tier nextTierFor cannot improve on is Pro, whose
    // null ceiling already returned Case A above (proved by a test over every
    // tier). Falling back to Case A keeps the dialog actionable rather than
    // blank if that ever stops holding.
    return addSeatCase({ tier, period, owned, target, inviteeName })
  }

  const next = PLANS[nextTier]
  const nextTarget = targetSeatsFor(nextTier, owned, seatsInUse)
  const todayCents = planChargeCents(tier, period, owned)
  const nextCents = planChargeCents(nextTier, period, nextTarget)
  const difference = nextCents - todayCents

  return {
    kind: 'upgrade',
    title: `${plan.name} is full`,
    body:
      `${plan.name} holds a maximum of ${plan.maxSeats} seats and all ${plan.maxSeats} are in use. ` +
      (next.maxSeats == null
        ? `${next.name} has no seat limit.`
        : `${next.name} covers up to ${next.maxSeats} cleaners.`),
    selection: { tier: nextTier, period, seat_count: nextTarget },
    lines: [
      { label: `${plan.name} today, ${owned} ${seatWord(owned)}`, cents: todayCents },
      { label: `${next.name}, ${nextTarget} ${seatWord(nextTarget)}`, cents: nextCents },
    ],
    totalLabel: totalLabelFor(period),
    // Both sides are catalogue prices, so this compares two PLANS and cannot
    // drift from the invoice the way a figure mixing a Stripe total with a
    // sticker price would.
    comparison:
      difference > 0
        ? `${next.name} is ${formatCents(difference)} more a ${periodWord(period)} than ${plan.name}.`
        : null,
    cancelLabel: 'Not now',
    confirmLabel: `Move to ${next.name}`,
  }
}

function totalLabelFor(period: BillingPeriod): string {
  // Ruling R17 asks for the new MONTHLY total. On an annual subscription the
  // figure the preview returns is a year's charge, so the label follows the
  // cadence: "New monthly total" over a yearly amount would be the same
  // mislabelling ruling R21 v2 forbids on the paywall.
  return period === 'annual' ? 'New yearly total' : 'New monthly total'
}

// ---------------------------------------------------------------------------
// The quote
// ---------------------------------------------------------------------------

export interface SeatQuoteState {
  /** 'pending' means show a skeleton. It NEVER means show the last number. */
  status: 'pending' | 'error' | 'ready'
  /** Non-null ONLY when it describes the purchase currently on screen. */
  preview: PlanPreviewPayload | null
  canConfirm: boolean
}

/**
 * The same rule PlanPicker keeps, for a dialog with a fixed selection: never
 * show a number we are not certain of, and never let anyone buy at an unknown
 * price.
 *
 * `preview` is withheld while the request is in flight even when TanStack
 * Query still holds cached data for the key, because cached data plus a
 * refetch is precisely the window in which the screen can disagree with the
 * invoice. A skeleton is the only honest thing to draw there.
 */
export function seatQuoteState(args: {
  /** False for the cases that show no money at all (trial, non-owner). */
  needsQuote: boolean
  isFetching: boolean
  error: unknown
  data: PlanPreviewPayload | null | undefined
  submitting: boolean
}): SeatQuoteState {
  if (!args.needsQuote) return { status: 'ready', preview: null, canConfirm: !args.submitting }
  if (args.isFetching) return { status: 'pending', preview: null, canConfirm: false }
  if (args.error) return { status: 'error', preview: null, canConfirm: false }
  if (!args.data) return { status: 'pending', preview: null, canConfirm: false }
  return { status: 'ready', preview: args.data, canConfirm: !args.submitting }
}

export interface SeatCapTotalRow {
  label: string
  cents: number
}

/**
 * Ruling R17. The prominent figure is the NEW TOTAL the org will pay per
 * period, taken from the preview, never the delta and never the sum of the
 * catalogue lines above it. Silent or vague seat charges are what generated
 * the public complaints against ClickUp and Loom.
 *
 * recurring_cents is what the plan costs per period AFTER the change, tax
 * included when the tax flag is on. due_now_cents is a different number and
 * belongs in the supporting sentence (seatCapNotes), not here.
 */
export function seatCapTotalRow(preview: PlanPreviewPayload, label: string): SeatCapTotalRow {
  return { label, cents: Math.max(0, preview.recurring_cents) }
}

/**
 * The supporting lines under the total.
 *
 * Ruling R21 v2: money copy follows the COMPUTED AMOUNT, never a direction and
 * never an assumption. Across comparable products access is granted
 * immediately and the charge lands on the next invoice, so this says money is
 * taken today only when the preview says it is.
 */
export function seatCapNotes(args: {
  preview: PlanPreviewPayload
  inviteeName: string | null
}): string[] {
  const { preview, inviteeName } = args
  const notes: string[] = []
  const dueNow = Math.max(0, preview.due_now_cents)
  const date = formatBillingDate(preview.next_charge_at)
  const person = inviteeName ?? 'Your new cleaner'

  if (preview.is_new_subscription) {
    // No live subscription, so the apply route hands back a hosted Checkout
    // URL (ruling R10) and the browser leaves this screen. Say so before the
    // redirect rather than after it.
    notes.push(`${formatCents(dueNow)} is due at checkout, on a secure Stripe payment page.`)
    notes.push(`${person} can start as soon as that payment goes through.`)
  } else if (dueNow > 0) {
    notes.push(`${formatCents(dueNow)} is charged today, for the rest of your current billing period.`)
    notes.push(`${person} can start right away.`)
  } else {
    notes.push(
      date
        ? `Nothing is charged today. The new total starts on ${date}.`
        : 'Nothing is charged today. The new total starts on your next invoice.',
    )
    notes.push(`${person} can start right away.`)
  }

  // Ruling R8's honesty valve, same wording as the plan picker: when the tax
  // flag is off the quote is short of what Stripe will take. "At checkout"
  // is only true for is_new_subscription (Case B from a canceled org with a
  // leftover tier); every other reachable case is an in-app Add seat / Move
  // to plan on a live subscription, with no checkout page in the flow.
  if (preview.tax_excluded) {
    notes.push(
      preview.is_new_subscription
        ? 'Sales tax is calculated at checkout.'
        : 'Sales tax will be added when this change is applied.',
    )
  }

  return notes
}

const GENERIC_PRICE_ERROR = 'Could not price this change. Please try again.'
const PAST_DUE_PRICE_ERROR = 'Please update your payment method before adding a seat.'

/**
 * The preview route refuses a past_due or unpaid org with the machine string
 * `billing_payment_required`, which billing-api rethrows verbatim. Showing
 * that to an operator is the same class of bug as the raw "seat_cap_reached"
 * this whole feature exists to stop.
 */
export function priceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (message.includes('billing_payment_required')) return PAST_DUE_PRICE_ERROR
  return GENERIC_PRICE_ERROR
}

/**
 * What the invite flow says when the dialog CANNOT render at all.
 *
 * The server 409 is gated by BILLING_ENFORCEMENT_ENABLED and this dialog by
 * the NEXT_PUBLIC_ mirror. They are two environment variables and can drift,
 * and billing state can also fail to load. In that window the operator would
 * otherwise click Send invite and get nothing back, which is the exact
 * no-feedback failure this task exists to end. Returns null whenever the
 * dialog can render, so the caller cannot show both.
 */
export function seatCapFallbackToast(args: {
  uiEnabled: boolean
  access: BillingAccess | null
  inviteeName: string | null
}): string | null {
  const caseFor = seatCapCaseFor({
    uiEnabled: args.uiEnabled,
    access: args.access,
    // Deliberately the least privileged answer: this string is only ever used
    // when no case could be built, so it must never imply a purchase.
    isOwner: false,
    tier: null,
    seatCount: null,
    seatsInUse: 0,
    period: null,
    inviteeName: args.inviteeName,
  })
  if (caseFor.kind !== 'unavailable') return null
  return `All of your cleaner seats are in use, so ${who(args.inviteeName)} could not be invited.`
}
