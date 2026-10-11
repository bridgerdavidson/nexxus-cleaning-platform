// Task 8: the three-step severity ladder (ruling R13) that carries a trialing
// or frozen organization toward paying, from a quiet pill through a firmer
// banner to the persistent view-only bar a frozen org lives under.
//
// Every decision lives here as a pure function, not in BillingBanners.tsx or
// TrialPill.tsx. This repo has no component-rendering setup and
// @testing-library/react is not installed (standing decision, see
// paywallModel.ts), so a rule left inside a .tsx file is a rule with no
// coverage. The two components are thin renderers over trialPillState and
// billingBanner below.

import type { BillingAccess, BillingState } from '@/lib/billing/access'
import { formatBillingDate } from '@/lib/billing/format'

// ---------------------------------------------------------------------------
// Step 1: the trial pill
// ---------------------------------------------------------------------------

export type TrialPillVariant = 'secondary' | 'caution'

export type TrialPillState =
  | { show: false }
  | { show: true; variant: TrialPillVariant; label: string; dismissible: boolean }

export interface TrialPillInput {
  uiEnabled: boolean
  /** Owner or admin (useBilling().canSeeBillingChrome). Managers never see the pill. */
  canSeeBillingChrome: boolean
  access: BillingAccess | null
  /** Read from sessionStorage by the component. Meaningless once the pill has
   *  escalated past day 3, where dismissibility ends (ruling R14). */
  dismissed: boolean
}

const PILL_HIDDEN: TrialPillState = { show: false }

/**
 * The quiet pill and its firmer, non-dismissible cousin are one decision, not
 * two components that could drift on where the day-3 cutoff sits (ruling
 * R14). At day 0 this returns hidden on purpose: that instant the state is
 * `trial_expired`, not `trialing`, and the frozen bar (billingBanner below)
 * owns the message from there.
 */
export function trialPillState(input: TrialPillInput): TrialPillState {
  if (!input.uiEnabled) return PILL_HIDDEN
  if (!input.canSeeBillingChrome) return PILL_HIDDEN
  if (!input.access || input.access.state !== 'trialing') return PILL_HIDDEN

  const days = input.access.trialDaysLeft
  // Only null when not trialing, which the guard above already excludes;
  // checked defensively rather than asserted away.
  if (days === null || days === 0) return PILL_HIDDEN

  if (days <= 3) {
    return {
      show: true,
      variant: 'caution',
      label: days === 1 ? '1 day left' : `${days} days left`,
      dismissible: false,
    }
  }

  if (input.dismissed) return PILL_HIDDEN
  return { show: true, variant: 'secondary', label: `Trial, ${days} days left`, dismissible: true }
}

// ---------------------------------------------------------------------------
// Steps 2 to 4: the banner ladder
// ---------------------------------------------------------------------------

export type BannerTone = 'neutral' | 'caution' | 'critical'
export type BannerActionKind = 'extend' | 'choose-plan' | 'update-payment'

export interface BannerAction {
  kind: BannerActionKind
  label: string
  variant: 'outline' | 'default'
}

export interface BannerSpec {
  tone: BannerTone
  message: string
  actions: BannerAction[]
}

export interface BillingBannerInput {
  uiEnabled: boolean
  access: BillingAccess | null
  isOwner: boolean
  /** Owner or admin (useBilling().canSeeBillingChrome). */
  canSeeBillingChrome: boolean
  /** Raw ISO from organizations.billing_pause_resumes_at; formatted here, same
   *  division of labor as paywallModel's paywallCopyFor. */
  pauseResumesAt: string | null
}

const EXTEND_ACTION: BannerAction = { kind: 'extend', label: 'Extend seven days', variant: 'outline' }
const CHOOSE_PLAN_ACTION: BannerAction = { kind: 'choose-plan', label: 'Choose a plan', variant: 'default' }
const UPDATE_PAYMENT_ACTION: BannerAction = {
  kind: 'update-payment',
  label: 'Update payment method',
  variant: 'outline',
}

const PAST_DUE_MESSAGE =
  'We could not process your last payment. Update your payment method to keep your account active.'

const FROZEN_NON_OWNER_MESSAGE =
  'View-only mode. New bookings are paused until the account owner updates the plan. Scheduled jobs still run.'

/**
 * `paused`'s own non-owner sentence. The default FROZEN_NON_OWNER_MESSAGE
 * says bookings stay paused "until the account owner updates the plan",
 * which is a real fact for trial_expired and canceled (the owner really can
 * fix those by choosing a plan) but false for paused: the pause is ours, not
 * theirs, and there is no plan the owner could update to lift it (mirrors
 * `access.state !== 'paused'` a few lines below, which withholds the SAME
 * false promise from the owner's own actions).
 */
const PAUSED_NON_OWNER_MESSAGE =
  'View-only mode. Your account is paused. New bookings are paused. Scheduled jobs still run.'

function frozenNonOwnerMessage(state: BillingState): string {
  return state === 'paused' ? PAUSED_NON_OWNER_MESSAGE : FROZEN_NON_OWNER_MESSAGE
}

/**
 * `unpaid`'s own view-only line (I2 / ruling R22). Ruling R22 says this
 * branch is defensive only, but defensive does not mean false: the org's
 * subscription failed payment, not its trial, and the paywall
 * (paywallModel.ts) and Settings (billingSectionModel.ts's UNPAID_NOTICE)
 * already say so. Falling through to the trial_expired sentence here told an
 * owner "Your trial ended" over a payment failure, which is the exact wrong
 * message ruling R22 exists to prevent.
 */
const UNPAID_MESSAGE =
  'View-only mode. We could not process your payment, so new bookings are paused. Scheduled jobs still run.'

/**
 * Step 2's owner-facing message, one branch per frozen state with locked
 * copy. `unpaid` is handled in billingBanner before this function is ever
 * called (it needs the admin audience past_due gets, not the owner-only
 * ladder below), so the default branch below only ever serves trial_expired
 * in practice; it stays as a safe fallback rather than a call this function
 * cannot otherwise satisfy.
 */
function frozenOwnerMessage(state: BillingState, pauseResumesAt: string | null): string {
  switch (state) {
    case 'canceled':
      return 'View-only mode. Your subscription ended, so new bookings are paused. Scheduled jobs still run.'
    case 'paused': {
      const until = formatBillingDate(pauseResumesAt)
      // An absent or unparseable resume date must never render as "paused
      // until . New bookings", so the date drops out of the sentence
      // entirely rather than leaving a gap (same rule as paywallCopyFor).
      return until
        ? `Your account is paused until ${until}. New bookings are paused. Scheduled jobs still run.`
        : 'Your account is paused. New bookings are paused. Scheduled jobs still run.'
    }
    case 'trial_expired':
    default:
      return 'View-only mode. Your trial ended, so new bookings are paused. Scheduled jobs still run.'
  }
}

/**
 * The whole ladder, one banner at a time (or none). The numbered branches
 * below match the precedence in task-8-brief.md, with `unpaid` split out of
 * the frozen ladder as its own remediation branch (I2), and must stay in
 * this order. Every branch is an early return: the states involved
 * are mutually exclusive by construction (BillingAccess.state is a single
 * discriminant from deriveBillingAccess), but the early returns keep exactly
 * one banner possible even if that ever stops being true, rather than
 * relying on the caller to notice two conditions both matched.
 */
export function billingBanner(input: BillingBannerInput): BannerSpec | null {
  if (!input.uiEnabled) return null
  const { access, isOwner, canSeeBillingChrome } = input
  if (!access) return null

  // 1. past_due, owner or admin only. This is deliberately NOT gated on
  // `frozen`: dunning now ends by cancelling (ruling R22), so past_due never
  // blocks bookings and a manager has nothing actionable to learn from it.
  if (access.state === 'past_due') {
    if (!canSeeBillingChrome) return null
    // Ruling R15 v4, remediation is not purchase. Updating the card keeps an
    // existing agreement alive; it does not change what is owed. So its
    // audience is the canSeeBillingChrome gate just above (owner AND admin),
    // the same audience Settings gives it and the same one
    // /api/stripe/billing/portal-link already allows. An owner on holiday
    // must not be able to freeze a business the admin running it day to day
    // is powerless to rescue. Purchase actions (Choose a plan, Extend) stay
    // owner only, below.
    return {
      tone: 'critical',
      message: PAST_DUE_MESSAGE,
      actions: [UPDATE_PAYMENT_ACTION],
    }
  }

  // 2. unpaid, owner or admin (ruling R15 v4: remediation is not purchase,
  // same audience and action as past_due, not "Choose a plan": there is
  // nothing new to sell, the existing subscription just needs a working
  // card). Unlike past_due, unpaid DOES block bookings, so a manager still
  // gets the generic explanation below rather than nothing at all.
  if (access.state === 'unpaid') {
    if (canSeeBillingChrome) {
      return { tone: 'critical', message: UNPAID_MESSAGE, actions: [UPDATE_PAYMENT_ACTION] }
    }
    return { tone: 'neutral', message: FROZEN_NON_OWNER_MESSAGE, actions: [] }
  }

  // 3 & 4. Frozen: the view-only bar for the remaining frozen states
  // (trial_expired, canceled, paused). Every role this shell renders for
  // (owner, admin, manager) can reach this branch; cleaners are on a
  // different shell and never mount this component (ruling R15).
  if (access.frozen) {
    if (isOwner) {
      const actions: BannerAction[] = []
      // `paused` sells nothing: the pause is ours, not theirs (mirrors
      // showsPlanPicker in paywallModel.ts).
      if (access.state !== 'paused') {
        if (access.canExtendTrial) actions.push(EXTEND_ACTION)
        actions.push(CHOOSE_PLAN_ACTION)
      }
      return { tone: 'critical', message: frozenOwnerMessage(access.state, input.pauseResumesAt), actions }
    }
    // Rulings R2 + R15: admin and manager both get the explanation, with NO
    // actions and no chrome gate. A manager who cannot create a booking must
    // still learn why, or this reproduces the Asana dead-control failure.
    return { tone: 'neutral', message: frozenNonOwnerMessage(access.state), actions: [] }
  }

  // 5. The <=3 day countdown. Owner and admin both see the banner; only the
  // owner gets buttons (ruling R2: pay CTAs are owner only).
  if (access.state === 'trialing' && canSeeBillingChrome) {
    const days = access.trialDaysLeft
    if (days !== null && days > 0 && days <= 3) {
      const message =
        days === 1
          ? 'Your trial ends tomorrow. After that your account becomes view-only and you cannot add new bookings.'
          : `Your trial ends in ${days} days. Choose a plan to keep booking jobs.`
      const actions: BannerAction[] = []
      if (isOwner) {
        if (access.canExtendTrial) actions.push(EXTEND_ACTION)
        actions.push(CHOOSE_PLAN_ACTION)
      }
      return { tone: 'caution', message, actions }
    }
  }

  // 6. Otherwise nothing: active, comped, or a trial with more than 3 days
  // left (the pill, not this ladder, covers that last one).
  return null
}
