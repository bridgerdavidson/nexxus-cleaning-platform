// Task 11: the hosted Checkout return states. Every test below maps to a
// specific way this can fail at the worst possible moment, right after a
// customer has handed over money: polling that never gives up, a timeout
// that reads as an error, a cancelled Checkout that nags, a query param that
// does not clear (so the whole flow replays), or router.replace silently
// no-opping in its place. This repo has no component-rendering setup and
// @testing-library/react is not installed, so the wiring section at the
// bottom statically scans CheckoutReturn.tsx's source for each of these.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  afterConfirmedPause,
  afterPollTick,
  ACTIVATING_MESSAGE,
  CONFIRMED_DISPLAY_MS,
  CONFIRMED_MESSAGE,
  copyForPhase,
  initialPhase,
  MAX_POLL_ATTEMPTS,
  parseCheckoutParam,
  POLL_INTERVAL_MS,
  replacesChildren,
  TIMEOUT_MESSAGE,
  type PollState,
} from './checkoutReturnModel'

const EM_DASH = '—'

// ---------------------------------------------------------------------------
// parseCheckoutParam / initialPhase
// ---------------------------------------------------------------------------

describe('parseCheckoutParam', () => {
  it('recognises exactly success and canceled, nothing else', () => {
    expect(parseCheckoutParam('success')).toBe('success')
    expect(parseCheckoutParam('canceled')).toBe('canceled')
    expect(parseCheckoutParam(null)).toBeNull()
    expect(parseCheckoutParam('')).toBeNull()
    // Mutation target: a loose comparison that also matches "cancelled"
    // (double L) or "Success" would silently stop clearing the param for
    // either misspelling / miscase Stripe never actually sends.
    expect(parseCheckoutParam('cancelled')).toBeNull()
    expect(parseCheckoutParam('Success')).toBeNull()
    expect(parseCheckoutParam('success ')).toBeNull()
  })
})

describe('initialPhase', () => {
  it('starts activating on success and idle on everything else', () => {
    expect(initialPhase('success')).toBe('activating')
    expect(initialPhase('canceled')).toBe('idle')
    expect(initialPhase(null)).toBe('idle')
  })

  // Mutation target: "?checkout=canceled producing a visible message". A
  // canceled Checkout must start in the exact same phase as no checkout
  // param at all: idle, nothing rendered, spec's "return silently".
  it('never gives canceled its own phase distinct from a plain page view', () => {
    expect(initialPhase('canceled')).toBe(initialPhase(null))
  })
})

// ---------------------------------------------------------------------------
// afterPollTick: the polling state machine
// ---------------------------------------------------------------------------

describe('afterPollTick', () => {
  const activating = (attempts = 0): PollState => ({ phase: 'activating', attempts })

  it('moves straight to confirmed the instant the mirror reports unfrozen', () => {
    expect(afterPollTick(activating(3), false)).toEqual({ phase: 'confirmed', attempts: 3 })
  })

  it('keeps polling and counts the attempt while still frozen', () => {
    expect(afterPollTick(activating(0), true)).toEqual({ phase: 'activating', attempts: 1 })
  })

  // A failed read (network hiccup) must never be treated as success, and
  // must never be treated as a reason to stop early either: it costs one
  // attempt, same as "still frozen".
  it('treats a failed read (null) as "not yet", not as success or as a fatal error', () => {
    expect(afterPollTick(activating(0), null)).toEqual({ phase: 'activating', attempts: 1 })
  })

  // THE mutation target named in the brief: polling that never terminates.
  // Confirms the transition actually happens exactly at the budget, not one
  // tick early or late, and never gets stuck in 'activating' forever.
  it('gives up at exactly MAX_POLL_ATTEMPTS, never earlier, never later, never stuck', () => {
    let state = activating(0)
    for (let i = 0; i < MAX_POLL_ATTEMPTS - 1; i++) {
      state = afterPollTick(state, true)
      expect(state.phase, `tick ${i + 1}`).toBe('activating')
    }
    expect(state.attempts).toBe(MAX_POLL_ATTEMPTS - 1)
    state = afterPollTick(state, true)
    expect(state).toEqual({ phase: 'timeout', attempts: MAX_POLL_ATTEMPTS })
  })

  it('never revives a timed-out or confirmed poll: a stray late tick is a no-op', () => {
    expect(afterPollTick({ phase: 'timeout', attempts: MAX_POLL_ATTEMPTS }, false)).toEqual({
      phase: 'timeout',
      attempts: MAX_POLL_ATTEMPTS,
    })
    expect(afterPollTick({ phase: 'confirmed', attempts: 5 }, true)).toEqual({
      phase: 'confirmed',
      attempts: 5,
    })
  })

  it('is a no-op outside activating, including idle', () => {
    expect(afterPollTick({ phase: 'idle', attempts: 0 }, false)).toEqual({
      phase: 'idle',
      attempts: 0,
    })
  })

  // Pins the budget itself: 15 attempts x 2s = 30s, matching the brief's "up
  // to 30 seconds" exactly. A change to either constant without updating the
  // other silently drifts the real wall-clock budget the customer sees.
  it('POLL_INTERVAL_MS times MAX_POLL_ATTEMPTS is exactly 30 seconds', () => {
    expect(POLL_INTERVAL_MS * MAX_POLL_ATTEMPTS).toBe(30_000)
  })
})

// ---------------------------------------------------------------------------
// afterConfirmedPause
// ---------------------------------------------------------------------------

describe('afterConfirmedPause', () => {
  it('reveals the real content (idle) once the confirmation pause elapses', () => {
    expect(afterConfirmedPause({ phase: 'confirmed', attempts: 4 })).toEqual({
      phase: 'idle',
      attempts: 4,
    })
  })

  it('is a no-op in every other phase', () => {
    for (const phase of ['idle', 'activating', 'timeout'] as const) {
      const state = { phase, attempts: 2 }
      expect(afterConfirmedPause(state)).toEqual(state)
    }
  })

  it('the confirmation pause is genuinely brief: well under the poll budget', () => {
    expect(CONFIRMED_DISPLAY_MS).toBeGreaterThan(0)
    expect(CONFIRMED_DISPLAY_MS).toBeLessThan(POLL_INTERVAL_MS * MAX_POLL_ATTEMPTS)
  })
})

// ---------------------------------------------------------------------------
// copyForPhase: exact strings, and no phase ever reads like an error
// ---------------------------------------------------------------------------

describe('copyForPhase', () => {
  it('says exactly "Activating your plan" while polling', () => {
    expect(copyForPhase('activating')).toEqual({
      message: 'Activating your plan',
      tone: 'neutral',
      showSpinner: true,
    })
    expect(ACTIVATING_MESSAGE).toBe('Activating your plan')
  })

  it('says exactly "You are all set" on confirmation, no spinner', () => {
    expect(copyForPhase('confirmed')).toEqual({
      message: 'You are all set',
      tone: 'positive',
      showSpinner: false,
    })
    expect(CONFIRMED_MESSAGE).toBe('You are all set')
  })

  // THE second mutation target named in the brief: a timeout that reads as
  // an error. Pins the exact reassurance sentence from the brief, and
  // separately asserts the tone is never critical/error.
  it('the timeout message is reassurance, not an error, word for word', () => {
    const copy = copyForPhase('timeout')!
    expect(copy.message).toBe(
      'Your payment went through. Your account is still updating, which can take a moment. Refresh in a minute or contact us if it persists.',
    )
    expect(TIMEOUT_MESSAGE).toBe(copy.message)
    expect(copy.showSpinner).toBe(false)
  })

  it('never returns a critical/error tone for any phase, including timeout', () => {
    for (const phase of ['activating', 'confirmed', 'timeout'] as const) {
      const copy = copyForPhase(phase)!
      expect(copy.tone).not.toBe('critical')
      expect(copy.tone).not.toBe('error')
      expect(['neutral', 'positive']).toContain(copy.tone)
    }
  })

  it('never mentions failure, error, or wrong in any phase copy', () => {
    for (const phase of ['activating', 'confirmed', 'timeout'] as const) {
      const message = copyForPhase(phase)!.message.toLowerCase()
      expect(message).not.toMatch(/fail|error|wrong|sorry|unable/)
    }
  })

  // THE third mutation target: canceled producing a visible message. idle
  // (which is what both "no checkout param" and "canceled" resolve to) must
  // render nothing at all.
  it('returns null for idle: nothing renders for a plain view or a cancelled Checkout', () => {
    expect(copyForPhase('idle')).toBeNull()
  })

  it('carries no em dash in any phase', () => {
    for (const phase of ['activating', 'confirmed', 'timeout'] as const) {
      expect(copyForPhase(phase)!.message).not.toContain(EM_DASH)
    }
  })
})

// ---------------------------------------------------------------------------
// replacesChildren: the takeover boundary. Timeout is deliberately excluded.
// ---------------------------------------------------------------------------

describe('replacesChildren', () => {
  it('takes over for activating and confirmed only', () => {
    expect(replacesChildren('activating')).toBe(true)
    expect(replacesChildren('confirmed')).toBe(true)
  })

  // Giving up on polling must never trap the customer behind a message with
  // no way to reach their own account.
  it('never takes over on timeout: the customer must still reach their account', () => {
    expect(replacesChildren('timeout')).toBe(false)
  })

  it('never takes over on idle', () => {
    expect(replacesChildren('idle')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Wiring: CheckoutReturn.tsx cannot be mounted (no component-rendering setup,
// no @testing-library/react by standing decision). These static checks are
// the only guard that the renderer honours the model above and the repo's
// hard rules. Each maps to a specific mutation that would otherwise ship
// silently.
// ---------------------------------------------------------------------------

/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('CheckoutReturn wiring', () => {
  const source = readFileSync(new URL('./CheckoutReturn.tsx', import.meta.url), 'utf8')
  const clean = code(source)

  // THE fifth mutation target: router.replace used instead of
  // replaceSearchShallow. Next 16 no-ops a same-path router.replace after a
  // reload-with-params (memory: shallow-search-nav-rule); the hard repo rule
  // is replaceSearchShallow, always, for a same-pathname update.
  it('clears the query string with replaceSearchShallow, never router.replace', () => {
    expect(clean).toContain("import { replaceSearchShallow } from '@/lib/shallowSearch'")
    expect(clean).toMatch(/replaceSearchShallow\(/)
    expect(clean).not.toMatch(/router\.replace\(/)
    expect(clean).not.toContain('useRouter')
  })

  // THE fourth mutation target: the parameter not being cleared, so the
  // state replays. Two independent guards: the phase is seeded once via a
  // lazy useState initializer (never re-derived from the live search param
  // on a later render), and the clearing effect is guarded so it can only
  // ever fire once per mount.
  it('seeds phase from the URL exactly once, via a lazy useState initializer', () => {
    expect(clean).toMatch(/useState<PollState>\(\(\) => \(\{\s*phase: initialPhase\(/)
  })

  it('guards the clearing effect so it can only run once, for both success and canceled', () => {
    expect(clean).toMatch(/const clearedRef = React\.useRef\(false\)/)
    expect(clean).toMatch(/if \(clearedRef\.current\) return/)
    expect(clean).toMatch(/clearedRef\.current = true/)
    // Both terminal param values are handled by the same clearing effect,
    // not just success: a stale ?checkout=canceled left in the URL would
    // silently re-arm on the next render that happens to re-read it.
    expect(clean).toMatch(/raw !== 'success' && raw !== 'canceled'/)
  })

  it('the clearing effect preserves every other query param (section=billing above all)', () => {
    expect(clean).toMatch(/new URLSearchParams\(window\.location\.search\)/)
    expect(clean).toMatch(/params\.delete\('checkout'\)/)
    // Never a bare replaceSearchShallow('') / replaceSearchShallow(pathname)
    // that would drop section=billing and bounce the settings page to its
    // default section mid-confirmation.
    expect(clean).not.toMatch(/replaceSearchShallow\(window\.location\.pathname\)/)
  })

  // THE first mutation target, at the wiring layer: the poll loop must
  // actually be wired to the model's afterPollTick and to a real timer at
  // POLL_INTERVAL_MS, not a hand-rolled loop with its own (possibly
  // unbounded) condition.
  it('polls on a real timer at POLL_INTERVAL_MS and decides every tick through afterPollTick', () => {
    expect(clean).toMatch(/setInterval\([\s\S]*?POLL_INTERVAL_MS\)/)
    expect(clean).toContain('afterPollTick(')
    // The interval is torn down, so a finished or unmounted flow cannot keep
    // polling forever in the background either.
    expect(clean).toMatch(/return \(\) => \{[\s\S]*?clearInterval\(id\)/)
  })

  it('the confirmed pause is a real timer at CONFIRMED_DISPLAY_MS decided through afterConfirmedPause', () => {
    expect(clean).toMatch(/setTimeout\([\s\S]*?CONFIRMED_DISPLAY_MS\)/)
    expect(clean).toContain('afterConfirmedPause(')
    expect(clean).toMatch(/return \(\) => clearTimeout\(id\)/)
  })

  it('decides what to render through replacesChildren and copyForPhase, never a hand-rolled phase check', () => {
    expect(clean).toContain('replacesChildren(')
    expect(clean).toContain('copyForPhase(')
  })

  // THE second mutation target, at the wiring layer: nothing in the timeout
  // render path may use the app's error/critical vocabulary. past_due and
  // unpaid in BillingSection use AlertCircle and critical tokens; this file
  // must never reach for either.
  it('never uses the app error vocabulary (AlertCircle, critical/destructive tokens) anywhere', () => {
    expect(clean).not.toContain('AlertCircle')
    expect(clean).not.toMatch(/critical/)
    expect(clean).not.toMatch(/destructive/)
  })

  it('renders the loader only while showSpinner is true (activating), not for confirmed', () => {
    expect(clean).toContain('<NexxusLoader')
    expect(clean).toMatch(/copy\.showSpinner \? \(\s*<NexxusLoader/)
  })

  // THE third mutation target, at the wiring layer: a canceled Checkout must
  // never reach a branch that renders text of its own. There is no
  // 'canceled' case anywhere in this renderer; canceled and "no param" both
  // resolve to idle upstream, in the model.
  it('never special-cases "canceled" in the renderer: it is not a distinct render branch', () => {
    // 'canceled' legitimately appears once, comparing the raw URL param for
    // the clear-the-param effect (asserted above). It must never appear as a
    // render decision: CheckoutReturnPhase has no 'canceled' member, so a
    // branch keyed on it would always be dead code hiding a real bug.
    expect(clean).not.toMatch(/state\.phase === ['"]canceled['"]/)
    expect(clean).not.toMatch(/phase:\s*['"]canceled['"]/)
    expect((clean.match(/'canceled'/g) ?? []).length).toBe(1)
  })

  it('falls through to children, unwrapped, whenever there is nothing to resolve', () => {
    expect(clean).toMatch(/return <>\{children\}<\/>/)
  })

  it('the timeout branch renders children alongside its notice, never in place of them', () => {
    // Bounded to just the timeout if-block: slicing to end-of-file would
    // trivially pass off the unrelated final `return <>{children}</>`.
    const start = clean.indexOf("state.phase === 'timeout'")
    const end = clean.indexOf('return <>{children}</>')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(clean.slice(start, end)).toContain('{children}')
  })

  it('writes no raw hex colour and no em dash', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toContain(EM_DASH)
  })

  it('is a client component', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true)
  })
})
