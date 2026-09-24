// Every decision the paywall makes, as pure functions.
//
// This file exists for one reason: the wall it drives can hide a working
// company's entire schedule, so the rules about WHEN it appears and whether it
// can be dismissed have to be testable without rendering anything. This repo
// has no component-rendering setup, so a rule left inside the .tsx is a rule
// with no coverage.
//
// The single most important property here: `paywallGate` cannot return
// `show: true` unless `isOpen` is true, and `isOpen` is owned by a store whose
// `close()` has no conditions on it (see usePaywall.ts). That pairing is what
// makes the wall impossible to get stuck behind.

import type { BillingAccess, BillingState } from '@/lib/billing/access'
import { formatBillingDate } from '@/lib/billing/format'
import { PLAN_TIERS, type BillingPeriod, type PlanTier } from '@/lib/billing/plans'

export interface PaywallCopy {
  headline: string
  subhead: string
}

/**
 * Fixed copy per state. A frozen state with no entry returns null, and the gate
 * then renders the dashboard rather than a wall we have no words for. Failing
 * that way round is deliberate: a silent wall is the Asana failure.
 */
export function paywallCopyFor(
  state: BillingState,
  opts: { pauseResumesAt: string | null } = { pauseResumesAt: null },
): PaywallCopy | null {
  switch (state) {
    case 'trial_expired':
      return {
        headline: 'Your trial has ended',
        subhead: 'Your account is in view-only mode. Pick a plan to start booking again.',
      }
    case 'canceled':
      return {
        headline: 'Your subscription has ended',
        subhead: 'Your account is in view-only mode. Choose a plan to start booking again.',
      }
    case 'unpaid':
      return {
        headline: 'We could not process your payment',
        subhead:
          'Your account is in view-only mode. Update your payment method or choose a plan to continue.',
      }
    case 'paused': {
      const until = formatBillingDate(opts.pauseResumesAt)
      return {
        headline: 'Your account is paused',
        // No "Contact us": there is no support route on screen (or anywhere
        // in the product) for a customer to ask us to resume early, so that
        // invitation was a dead instruction. `pauseSubscription`
        // (src/lib/stripe/billing.ts) sets Stripe's own `resumes_at`, which
        // really does lift the pause on its own, so the date branch says
        // exactly that instead. An absent or unparseable resume date must
        // never render as "Paused until .", so the date drops out of the
        // sentence, and an open-ended pause makes no promise about when.
        subhead: until
          ? `Paused until ${until}. Your account resumes automatically on that date.`
          : 'Your account is paused for now. It will resume once the pause is lifted.',
      }
    }
    default:
      return null
  }
}

/**
 * A paused org is not being sold anything (spec 13): the pause is ours, not
 * theirs, and a plan picker on that screen would invite a charge that changes
 * nothing.
 */
export function showsPlanPicker(state: BillingState): boolean {
  return state !== 'paused'
}

/**
 * `unpaid`'s subhead promises "Update your payment method"; this is what
 * makes that sentence true rather than naming a control that is not on
 * screen. Ruling R15 v4 (remediation is not purchase) puts updating a
 * payment method in the owner+admin audience generally, but the WALL itself
 * is owner only regardless of state (`paywallGate` below), so there is no
 * extra role check to make here: whoever sees this wall may click this.
 */
export function showsUpdatePayment(state: BillingState): boolean {
  return state === 'unpaid'
}

export interface PaywallGateInput {
  /** NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED. Flag-dark until ops flips it. */
  uiEnabled: boolean
  /** Null while loading, or on a 403. Never a visible error. */
  access: BillingAccess | null
  /** Owner only (ruling R2). Admins and managers get a banner, never this. */
  isOwner: boolean
  /** The store's state. False means the user dismissed it, and that always wins. */
  isOpen: boolean
  pauseResumesAt: string | null
}

export type PaywallGate =
  | { show: false }
  | { show: true; copy: PaywallCopy; showPicker: boolean; showUpdatePayment: boolean }

const HIDDEN: PaywallGate = { show: false }

/**
 * The one place that decides whether the wall is on screen. Every clause is a
 * reason to show the DASHBOARD; there is no input that forces the wall over a
 * dismissal, because `isOpen` is checked like any other condition.
 */
export function paywallGate(input: PaywallGateInput): PaywallGate {
  if (!input.uiEnabled) return HIDDEN
  if (!input.access) return HIDDEN
  if (!input.access.frozen) return HIDDEN
  if (!input.isOwner) return HIDDEN
  if (!input.isOpen) return HIDDEN

  const copy = paywallCopyFor(input.access.state, { pauseResumesAt: input.pauseResumesAt })
  if (!copy) return HIDDEN

  return {
    show: true,
    copy,
    showPicker: showsPlanPicker(input.access.state),
    showUpdatePayment: showsUpdatePayment(input.access.state),
  }
}

/**
 * "Your data is still there" is only reassuring if it is true, so the counts
 * are used only when both are real and non-zero. "Your 0 jobs" is not a fact
 * about anybody, and no query is added just to fill this line.
 */
export function reassuranceLine(counts: { jobs: number | null; customers: number | null }): string {
  const { jobs, customers } = counts
  if (jobs != null && customers != null && jobs > 0 && customers > 0) {
    return `Your ${jobs} jobs, ${customers} customers and all cleaner payout history are exactly where you left them.`
  }
  return 'Your jobs, customers and cleaner payout history are exactly where you left them.'
}

/** Length of a cached list, or null for anything that is not a loaded list. */
export function cachedCount(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}

/** organizations.plan_tier is typed loosely; only a real tier reaches the picker. */
export function asPlanTier(value: unknown): PlanTier | null {
  return typeof value === 'string' && (PLAN_TIERS as string[]).includes(value)
    ? (value as PlanTier)
    : null
}

export function asBillingPeriod(value: unknown): BillingPeriod | null {
  return value === 'monthly' || value === 'annual' ? (value as BillingPeriod) : null
}
