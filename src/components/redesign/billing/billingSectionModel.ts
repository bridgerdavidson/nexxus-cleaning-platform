// Task 9: every decision Settings > Plan and billing makes, as pure functions.
//
// This is the CALM counterpart to the paywall (ruling R3): a compact summary of
// what the customer pays, with a "Change plan" action that opens the shared
// PlanPicker. It is deliberately not a permanent pricing table.
//
// The rules live here rather than in BillingSection.tsx for the same reason
// they live in paywallModel.ts and billingBannersModel.ts: this repo has no
// component-rendering setup and @testing-library/react is not installed, so a
// rule left inside a .tsx file is a rule with no coverage. Eight billing
// states times two roles is sixteen combinations, and the expensive failures
// (an admin handed a live money control, a cancelling subscription still
// advertising a renewal date) are invisible from the outside.
//
// BillingSection.tsx is a renderer over billingSectionView and actionStateFor.

import type { BillingAccess, BillingState } from '@/lib/billing/access'
import { formatBillingDate, formatCents } from '@/lib/billing/format'
import { PLANS, planChargeCents, type BillingPeriod, type PlanTier } from '@/lib/billing/plans'

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type BillingCardTone = 'neutral' | 'caution' | 'critical'

export type BillingActionKind =
  | 'choose-plan'
  | 'change-plan'
  | 'extend'
  | 'portal'
  | 'update-payment'
  | 'reactivate'

export interface BillingSectionAction {
  kind: BillingActionKind
  label: string
  variant: 'default' | 'outline' | 'link'
  /**
   * Ruling R15 v3: a control that CHANGES MONEY is owner only. An admin sees
   * it disabled with a reason, never hidden, because a hidden control teaches
   * nothing. Everything marked here maps to a server route that already
   * refuses a non-owner (`allowedRoles: ['owner']` on /api/billing/plan and
   * /api/billing/trial/extend), so the disabled state is honest rather than
   * decorative. The portal actions are NOT owner only: the portal route
   * allows owner and admin, so an admin really can reach invoices there.
   */
  ownerOnly: boolean
}

export interface BillingLine {
  text: string
  tone: 'muted' | 'caution'
}

export interface BillingCard {
  badgeLabel: string
  tone: BillingCardTone
  headline: string
  lines: BillingLine[]
}

export interface BillingNotice {
  tone: 'critical'
  message: string
}

export interface BillingSectionSpec {
  lead: string
  notice: BillingNotice | null
  card: BillingCard
  actions: BillingSectionAction[]
  /**
   * The submit label PlanPicker is mounted with, or null when this state
   * exposes no way to open it at all (paused, comped, unpaid). Null here and
   * an empty/portal-only `actions` list must agree; the picker has no other
   * way to open.
   */
  pickerSubmitLabel: string | null
}

export type BillingSectionView =
  | { kind: 'disabled'; message: string }
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'plan'; spec: BillingSectionSpec }

export interface BillingSectionInput {
  /** billingEnforcementUiEnabled(). Beats every other input. */
  uiEnabled: boolean
  isLoading: boolean
  access: BillingAccess | null
  seatsInUse: number
  /** organizations.plan_tier, already narrowed. Null on a trial. */
  tier: PlanTier | null
  period: BillingPeriod | null
  /** organizations.seat_count. */
  seatCount: number | null
  /** Sibling of `billing` on useBilling(), NOT a column on OrgBillingRow. */
  currentPeriodEnd: string | null
  /** organizations.subscription_cancel_at. */
  cancelAt: string | null
  /** organizations.billing_pause_resumes_at. */
  pauseResumesAt: string | null
}

// ---------------------------------------------------------------------------
// Copy and actions
// ---------------------------------------------------------------------------

export const BILLING_DISABLED_MESSAGE = 'Billing is not enabled for this account yet.'
export const BILLING_UNAVAILABLE_MESSAGE =
  'We could not load your plan details. Refresh the page to try again.'
export const OWNER_ONLY_REASON = 'Only the account owner can change the plan.'
export const PAST_DUE_NOTICE = 'We could not process your last payment.'
export const UNPAID_NOTICE =
  'We could not collect payment, so your account is in view-only mode.'

const LEAD = 'What you pay, how many seats you use, and where to find your invoices.'

const CHOOSE_PLAN: BillingSectionAction = {
  kind: 'choose-plan', label: 'Choose a plan', variant: 'default', ownerOnly: true,
}
const CHANGE_PLAN: BillingSectionAction = {
  kind: 'change-plan', label: 'Change plan', variant: 'default', ownerOnly: true,
}
/** past_due demotes Change plan: fixing the card comes first. */
const CHANGE_PLAN_SECONDARY: BillingSectionAction = { ...CHANGE_PLAN, variant: 'outline' }
const EXTEND: BillingSectionAction = {
  kind: 'extend', label: 'Extend your trial by seven days', variant: 'link', ownerOnly: true,
}
const PORTAL: BillingSectionAction = {
  kind: 'portal', label: 'Payment method and invoices', variant: 'outline', ownerOnly: false,
}
const UPDATE_PAYMENT: BillingSectionAction = {
  kind: 'update-payment', label: 'Update payment method', variant: 'default', ownerOnly: false,
}
const REACTIVATE: BillingSectionAction = {
  kind: 'reactivate', label: 'Reactivate', variant: 'default', ownerOnly: true,
}

/** Opening Checkout, versus editing a subscription that already exists. */
const BUY_LABEL = 'Continue to payment'
const UPDATE_LABEL = 'Update plan'

// ---------------------------------------------------------------------------
// Line builders
// ---------------------------------------------------------------------------

function seatsLine(seatsInUse: number, cap: number | null): BillingLine {
  // comped has no cap (seatCap null), so it gets a bare count with no
  // "of N" to imply a limit that does not exist.
  if (cap === null) {
    return { text: `${seatsInUse} ${seatsInUse === 1 ? 'seat' : 'seats'} in use`, tone: 'muted' }
  }
  return { text: `${seatsInUse} of ${cap} seats in use`, tone: 'muted' }
}

function trialSeatsLine(seatsInUse: number, cap: number | null): BillingLine {
  if (cap === null) return seatsLine(seatsInUse, null)
  return { text: `${seatsInUse} of ${cap} trial seats in use`, tone: 'muted' }
}

/**
 * The renewal line, or null. A scheduled cancellation REPLACES the renewal
 * date rather than sitting next to it: a subscription that ends on the 12th
 * does not also renew on the 12th, and printing both is how a customer comes
 * to believe they were charged after cancelling.
 *
 * An absent or unparseable date drops the line entirely rather than rendering
 * "Renews on ." (same discipline as paywallCopyFor).
 */
function renewalLine(currentPeriodEnd: string | null, cancelAt: string | null): BillingLine | null {
  const cancels = formatBillingDate(cancelAt)
  if (cancels) return { text: `Cancels on ${cancels}`, tone: 'caution' }
  const renews = formatBillingDate(currentPeriodEnd)
  if (renews) return { text: `Renews on ${renews}`, tone: 'muted' }
  return null
}

function priceHeadline(tier: PlanTier | null, period: BillingPeriod | null, seatCount: number | null): string {
  // Defensive: an active org with no tier on the row cannot be priced, so it
  // says what is true and nothing more, rather than guessing a number.
  if (!tier) return 'Your plan is active'
  const resolvedPeriod: BillingPeriod = period ?? 'monthly'
  const seats = seatCount ?? PLANS[tier].includedSeats
  const charge = planChargeCents(tier, resolvedPeriod, seats)
  return `${formatCents(charge)} ${resolvedPeriod === 'annual' ? 'per year' : 'per month'}`
}

function tierBadge(tier: PlanTier | null): string {
  return tier ? PLANS[tier].name : 'Your plan'
}

function trialHeadline(daysLeft: number | null): string {
  const days = daysLeft ?? 0
  return days === 1 ? '1 day left in your trial' : `${days} days left in your trial`
}

function withExtend(access: BillingAccess, actions: BillingSectionAction[]): BillingSectionAction[] {
  // Ruling R12: the extension is a good-faith affordance, never a primary CTA,
  // so it always trails the plan action as a link.
  return access.canExtendTrial ? [...actions, EXTEND] : actions
}

// ---------------------------------------------------------------------------
// The eight branches
// ---------------------------------------------------------------------------

function specFor(input: BillingSectionInput, access: BillingAccess): BillingSectionSpec {
  const { seatsInUse, tier, period, seatCount, currentPeriodEnd, cancelAt, pauseResumesAt } = input
  const state: BillingState = access.state

  switch (state) {
    case 'trialing':
      return {
        lead: LEAD,
        notice: null,
        card: {
          badgeLabel: 'Trial',
          tone: 'neutral',
          headline: trialHeadline(access.trialDaysLeft),
          lines: [trialSeatsLine(seatsInUse, access.seatCap)],
        },
        actions: withExtend(access, [CHOOSE_PLAN]),
        pickerSubmitLabel: BUY_LABEL,
      }

    case 'trial_expired':
      // Caution, not critical. The trial ending is definite, not a fault, and
      // the frozen bar in the shell is already carrying the alarm.
      return {
        lead: LEAD,
        notice: null,
        card: {
          badgeLabel: 'Trial ended',
          tone: 'caution',
          headline: 'Your trial has ended',
          lines: [trialSeatsLine(seatsInUse, access.seatCap)],
        },
        actions: withExtend(access, [CHOOSE_PLAN]),
        pickerSubmitLabel: BUY_LABEL,
      }

    case 'active': {
      const lines: BillingLine[] = [seatsLine(seatsInUse, access.seatCap)]
      const renewal = renewalLine(currentPeriodEnd, cancelAt)
      if (renewal) lines.push(renewal)
      return {
        lead: LEAD,
        notice: null,
        card: {
          badgeLabel: tierBadge(tier),
          tone: 'neutral',
          headline: priceHeadline(tier, period, seatCount),
          lines,
        },
        actions: [CHANGE_PLAN, PORTAL],
        pickerSubmitLabel: UPDATE_LABEL,
      }
    }

    case 'past_due': {
      // Everything active shows, plus the notice, with the actions reordered
      // so the thing that fixes the problem is the primary one.
      const lines: BillingLine[] = [seatsLine(seatsInUse, access.seatCap)]
      const renewal = renewalLine(currentPeriodEnd, cancelAt)
      if (renewal) lines.push(renewal)
      return {
        lead: LEAD,
        notice: { tone: 'critical', message: PAST_DUE_NOTICE },
        card: {
          badgeLabel: tierBadge(tier),
          tone: 'critical',
          headline: priceHeadline(tier, period, seatCount),
          lines,
        },
        actions: [UPDATE_PAYMENT, CHANGE_PLAN_SECONDARY],
        pickerSubmitLabel: UPDATE_LABEL,
      }
    }

    case 'unpaid':
      // Ruling R22: defensive only. Dunning now ends by cancelling, so a
      // lapsed customer lands in `canceled` instead and buys again through
      // Checkout. An `unpaid` org in production means the Stripe Dashboard
      // config has drifted. Built correctly, not designed for: the card needs
      // fixing, not a new plan, so the only action is the portal.
      return {
        lead: LEAD,
        notice: { tone: 'critical', message: UNPAID_NOTICE },
        card: {
          badgeLabel: tierBadge(tier),
          tone: 'critical',
          headline: priceHeadline(tier, period, seatCount),
          lines: [seatsLine(seatsInUse, access.seatCap)],
        },
        actions: [REACTIVATE],
        pickerSubmitLabel: null,
      }

    case 'canceled':
      return {
        lead: LEAD,
        notice: null,
        card: {
          badgeLabel: 'Canceled',
          tone: 'caution',
          headline: 'Your subscription has ended',
          lines: [seatsLine(seatsInUse, access.seatCap)],
        },
        // Choosing a plan here has no live subscription to edit, so
        // /api/billing/plan hands back a Checkout URL.
        actions: [CHOOSE_PLAN, PORTAL],
        pickerSubmitLabel: BUY_LABEL,
      }

    case 'paused': {
      const until = formatBillingDate(pauseResumesAt)
      return {
        lead: LEAD,
        notice: null,
        card: {
          badgeLabel: 'Paused',
          tone: 'caution',
          headline: until ? `Your account is paused until ${until}.` : 'Your account is paused.',
          lines: [{ text: 'Contact us to resume early.', tone: 'muted' }],
        },
        // NO CONTROLS. The pause is ours, not theirs; selling them a plan
        // they cannot use would be worse than saying nothing.
        actions: [],
        pickerSubmitLabel: null,
      }
    }

    case 'comped':
    default:
      return {
        lead: LEAD,
        notice: null,
        card: {
          badgeLabel: 'Complimentary',
          tone: 'neutral',
          headline: 'Complimentary plan',
          // seatCap is null for comped, so no cap is implied.
          lines: [seatsLine(seatsInUse, access.seatCap)],
        },
        actions: [],
        pickerSubmitLabel: null,
      }
  }
}

/**
 * The whole section, in one decision. Precedence is strict and the flag wins
 * outright: no billing surface may render before ops flips the UI flag, no
 * matter what state the org is in.
 */
export function billingSectionView(input: BillingSectionInput): BillingSectionView {
  if (!input.uiEnabled) return { kind: 'disabled', message: BILLING_DISABLED_MESSAGE }
  if (input.isLoading) return { kind: 'loading' }
  // access is null while the read is in flight AND when the read failed (a 403
  // leaves `data` undefined). Never an empty card, never a crash.
  if (!input.access) return { kind: 'unavailable', message: BILLING_UNAVAILABLE_MESSAGE }
  return { kind: 'plan', spec: specFor(input, input.access) }
}

export interface ActionState {
  disabled: boolean
  /** The tooltip text when disabled. Null when the control is live. */
  reason: string | null
}

/**
 * Ruling R15 v3. Disabled with a reason, NEVER hidden: an admin who cannot
 * find the control learns nothing, and asks the owner nothing.
 */
export function actionStateFor(action: BillingSectionAction, isOwner: boolean): ActionState {
  if (action.ownerOnly && !isOwner) return { disabled: true, reason: OWNER_ONLY_REASON }
  return { disabled: false, reason: null }
}

/** Badge variant per card tone. Kept here so the renderer maps nothing itself. */
export const BADGE_VARIANT_FOR_TONE: Record<BillingCardTone, 'secondary' | 'caution' | 'critical'> = {
  neutral: 'secondary',
  caution: 'caution',
  critical: 'critical',
}
