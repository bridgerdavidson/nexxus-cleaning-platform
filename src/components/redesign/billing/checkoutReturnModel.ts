// Task 11: the decisions behind the hosted Checkout return states, as pure
// functions. Same reasoning as billingSectionModel.ts and paywallModel.ts:
// this repo has no component-rendering setup and @testing-library/react is
// not installed, so every branch that matters lives here, under unit test.
// CheckoutReturn.tsx is a thin renderer plus the side effects (the poll
// timer, the confirmation timer, and clearing the query string).
//
// Checkout returns to Settings > Billing with the mirror possibly still a few
// seconds behind the redirect: the subscription lands by webhook, not by the
// redirect itself. The whole point of this file is that the lag must never
// read as a failure. A customer who has already paid has to see reassurance,
// however long the mirror takes; the nightly reconcileBillingMirror sweep is
// the backstop if it never catches up in this session at all.

export type CheckoutParam = 'success' | 'canceled' | null

export function parseCheckoutParam(raw: string | null): CheckoutParam {
  if (raw === 'success') return 'success'
  if (raw === 'canceled') return 'canceled'
  return null
}

export type CheckoutReturnPhase = 'idle' | 'activating' | 'confirmed' | 'timeout'

/** 2s between polls, 30s total budget, i.e. 15 attempts. */
export const POLL_INTERVAL_MS = 2_000
export const MAX_POLL_ATTEMPTS = 15
/** How long "You are all set" stays up before the real content shows. */
export const CONFIRMED_DISPLAY_MS = 1_200

/**
 * The phase to start in, read from the URL exactly once: the component seeds
 * a useState with this via a lazy initializer, never re-derives it from the
 * live search params on a later render. `canceled` starts idle: there is
 * nothing to show, only a param to clear (spec: "return silently").
 */
export function initialPhase(checkout: CheckoutParam): CheckoutReturnPhase {
  return checkout === 'success' ? 'activating' : 'idle'
}

export interface PollState {
  phase: CheckoutReturnPhase
  attempts: number
}

/**
 * One polling tick. `frozen` is what a freshly re-read access.frozen came
 * back as: false means the mirror caught up, true means it has not yet, null
 * means the read itself failed (a network hiccup) and counts against the
 * budget without resolving anything, exactly like "not yet".
 *
 * Mutation target: dropping the `attempts >= MAX_POLL_ATTEMPTS` branch (or
 * comparing with the wrong operator) leaves this polling forever, which is
 * the #1 failure mode named in the brief.
 */
export function afterPollTick(state: PollState, frozen: boolean | null): PollState {
  if (state.phase !== 'activating') return state
  if (frozen === false) return { phase: 'confirmed', attempts: state.attempts }
  const attempts = state.attempts + 1
  if (attempts >= MAX_POLL_ATTEMPTS) return { phase: 'timeout', attempts }
  return { phase: 'activating', attempts }
}

/** The confirmation pause elapsed: reveal the real content. No-op in any other phase. */
export function afterConfirmedPause(state: PollState): PollState {
  if (state.phase !== 'confirmed') return state
  return { phase: 'idle', attempts: state.attempts }
}

// ---------------------------------------------------------------------------
// Copy. Exact strings from the brief, used verbatim and nowhere re-typed.
// ---------------------------------------------------------------------------

export const ACTIVATING_MESSAGE = 'Activating your plan'
export const CONFIRMED_MESSAGE = 'You are all set'
export const TIMEOUT_MESSAGE =
  'Your payment went through. Your account is still updating, which can take a moment. Refresh in a minute or contact us if it persists.'

export type CheckoutReturnTone = 'neutral' | 'positive'

export interface CheckoutReturnCopy {
  message: string
  tone: CheckoutReturnTone
  showSpinner: boolean
}

/**
 * Null for 'idle': nothing renders for a plain page view or a cancelled
 * Checkout. Every other branch describes something good or neutral; none of
 * them carries a "critical" tone, and the timeout branch stays exactly as
 * reassuring as the brief's own copy, on purpose. A customer who has already
 * paid must never see anything that reads like a failure.
 */
export function copyForPhase(phase: CheckoutReturnPhase): CheckoutReturnCopy | null {
  switch (phase) {
    case 'activating':
      return { message: ACTIVATING_MESSAGE, tone: 'neutral', showSpinner: true }
    case 'confirmed':
      return { message: CONFIRMED_MESSAGE, tone: 'positive', showSpinner: false }
    case 'timeout':
      return { message: TIMEOUT_MESSAGE, tone: 'neutral', showSpinner: false }
    case 'idle':
    default:
      return null
  }
}

/**
 * True while CheckoutReturn should show its own UI INSTEAD OF the section's
 * real content: the two short-lived states where the data underneath is not
 * yet trustworthy to show. `timeout` is deliberately excluded: giving up on
 * polling must never trap the customer behind a message with no way to reach
 * their own account, so it renders as a non-blocking notice ABOVE the real
 * content instead (see CheckoutReturn.tsx). `idle` never takes over anything.
 */
export function replacesChildren(phase: CheckoutReturnPhase): boolean {
  return phase === 'activating' || phase === 'confirmed'
}
