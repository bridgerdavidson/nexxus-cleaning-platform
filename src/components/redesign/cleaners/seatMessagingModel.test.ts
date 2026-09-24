// Every test below maps to a specific way this can fail silently:
//   - the 409 seat-cap body falling through to the generic error toast (the
//     ORIGINAL bug: an operator reading the raw string "seat_cap_reached");
//   - the opposite mistake, a real error swallowed because it superficially
//     looks like the seat-cap shape;
//   - the seat indicator rendering during a trial before the cap is reached;
//   - the post-delete seat toast firing when the billing UI flag is off.
// Each has a dedicated test that would fail if the corresponding bug were
// reintroduced, plus wiring guards at the bottom: this repo has no
// component-rendering setup and @testing-library/react is not installed, so
// OperatorCleaners.tsx cannot be mounted. The guards are the only check that
// the renderer actually calls these functions instead of hand-rolling the
// same decisions inline (see billingActionParity.test.ts for the pattern).

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  classifyInviteResult,
  seatIndicatorText,
  postDeleteSeatToastMessage,
  type InviteResultLike,
  type SeatIndicatorInput,
  type PostDeleteSeatToastInput,
} from './seatMessagingModel'
import type { BillingAccess } from '@/lib/billing/access'

const EM_DASH = '—'

function access(over: Partial<BillingAccess> = {}): BillingAccess {
  return {
    state: 'active',
    frozen: false,
    trialDaysLeft: null,
    canExtendTrial: false,
    seatCap: 8,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// classifyInviteResult
// ---------------------------------------------------------------------------

describe('classifyInviteResult', () => {
  it('classifies a successful invite as sent', () => {
    expect(classifyInviteResult({ success: true })).toEqual({ kind: 'sent' })
  })

  it('classifies the real send-invite 409 body as seat_cap', () => {
    // The actual shape returned by src/app/api/admin/send-invite/route.ts:
    // { error: 'seat_cap_reached', cap, in_use, tier, next_tier }, status 409,
    // with NO top-level `success` field.
    const r: InviteResultLike = {
      success: false,
      status: 409,
      error: 'seat_cap_reached',
      body: { error: 'seat_cap_reached', cap: 8, in_use: 8, tier: 'growth', next_tier: 'Pro' },
    }
    expect(classifyInviteResult(r)).toEqual({ kind: 'seat_cap' })
  })

  it('never lets the raw seat_cap_reached string reach the toast copy', () => {
    // This is the original bug, pinned directly: the outcome for a seat-cap
    // 409 must carry no message at all (the caller shows a dialog instead),
    // so the raw API string can never end up in toast.error().
    const r: InviteResultLike = {
      success: false,
      status: 409,
      error: 'seat_cap_reached',
      body: { error: 'seat_cap_reached' },
    }
    const outcome = classifyInviteResult(r)
    expect(outcome.kind).toBe('seat_cap')
    expect(JSON.stringify(outcome)).not.toContain('seat_cap_reached')
  })

  it('treats a non-409 error as a real error, never swallowed', () => {
    const r: InviteResultLike = { success: false, status: 500, error: 'Server exploded' }
    expect(classifyInviteResult(r)).toEqual({ kind: 'error', message: 'Server exploded' })
  })

  it('treats a 409 with a different body shape as a real error, not seat_cap', () => {
    // The opposite mistake: not every 409 is the seat cap. A generic 409 for
    // an unrelated conflict must keep its own message, not be reclassified.
    const r: InviteResultLike = {
      success: false,
      status: 409,
      error: 'Some other conflict',
      body: { error: 'some_other_conflict' },
    }
    expect(classifyInviteResult(r)).toEqual({ kind: 'error', message: 'Some other conflict' })
  })

  it('treats a 400 validation error as a real error', () => {
    const r: InviteResultLike = { success: false, status: 400, error: 'Invalid email address.' }
    expect(classifyInviteResult(r)).toEqual({ kind: 'error', message: 'Invalid email address.' })
  })

  // Task 12: the org froze between the screen loading and Send invite being
  // clicked. Matches guard.ts's exact 402 body (src/lib/billing/guard.ts),
  // via inviteTeamMember's status/body passthrough.
  it('classifies the send-invite 402 billing_frozen body as frozen', () => {
    const r: InviteResultLike = {
      success: false,
      status: 402,
      error: 'billing_frozen',
      body: { error: 'billing_frozen', state: 'trial_expired', trial_ends_at: null, can_extend_trial: false },
    }
    expect(classifyInviteResult(r)).toEqual({ kind: 'frozen' })
  })

  it('never lets the raw billing_frozen string reach the toast copy', () => {
    const r: InviteResultLike = {
      success: false,
      status: 402,
      error: 'billing_frozen',
      body: { error: 'billing_frozen' },
    }
    const outcome = classifyInviteResult(r)
    expect(outcome.kind).toBe('frozen')
    expect(JSON.stringify(outcome)).not.toContain('billing_frozen')
  })

  // Opposite-mistake guard, mirroring the seat_cap one above: a 402 that is
  // NOT the billing_frozen shape (a different error code, or a 402 that
  // happens to lack a body) must stay a real, toasted error.
  it('treats a 402 with a different error code as a real error, not frozen', () => {
    const r: InviteResultLike = {
      success: false,
      status: 402,
      error: 'Some other reason',
      body: { error: 'some_other_reason' },
    }
    expect(classifyInviteResult(r)).toEqual({ kind: 'error', message: 'Some other reason' })
  })

  it('falls back to a default message on a network-level failure with no error string', () => {
    const r: InviteResultLike = { success: false }
    expect(classifyInviteResult(r)).toEqual({ kind: 'error', message: 'Could not send the invite' })
  })

  it('has no em dash in any error copy it can produce', () => {
    const outcome = classifyInviteResult({ success: false })
    if (outcome.kind === 'error') expect(outcome.message).not.toContain(EM_DASH)
  })
})

// ---------------------------------------------------------------------------
// seatIndicatorText
// ---------------------------------------------------------------------------

function seatInput(over: Partial<SeatIndicatorInput> = {}): SeatIndicatorInput {
  return {
    uiEnabled: true,
    access: access({ seatCap: 8 }),
    seatsInUse: 5,
    pendingCount: 0,
    isTrial: false,
    ...over,
  }
}

describe('seatIndicatorText', () => {
  it('renders nothing when the billing UI flag is off', () => {
    expect(seatIndicatorText(seatInput({ uiEnabled: false }))).toBeNull()
  })

  it('renders nothing while billing access has not loaded', () => {
    expect(seatIndicatorText(seatInput({ access: null }))).toBeNull()
  })

  it('renders nothing for an unlimited (comped) org, seatCap null', () => {
    expect(seatIndicatorText(seatInput({ access: access({ seatCap: null }) }))).toBeNull()
  })

  it('shows a plain used-of-total count with no pending invites', () => {
    expect(seatIndicatorText(seatInput({ seatsInUse: 5, pendingCount: 0 }))).toBe('5 of 8 seats used')
  })

  it('names pending invites separately from active seats', () => {
    expect(seatIndicatorText(seatInput({ seatsInUse: 7, pendingCount: 2 }))).toBe(
      '5 active and 2 pending of 8 seats',
    )
  })

  it('never prints a negative active count', () => {
    expect(seatIndicatorText(seatInput({ seatsInUse: 1, pendingCount: 3 }))).toBe(
      '0 active and 3 pending of 8 seats',
    )
  })

  it('hides the trial cap below the cap', () => {
    expect(
      seatIndicatorText(
        seatInput({ isTrial: true, access: access({ seatCap: 15 }), seatsInUse: 10, pendingCount: 0 }),
      ),
    ).toBeNull()
  })

  it('hides the trial cap one seat below the cap', () => {
    expect(
      seatIndicatorText(
        seatInput({ isTrial: true, access: access({ seatCap: 15 }), seatsInUse: 14, pendingCount: 0 }),
      ),
    ).toBeNull()
  })

  it('shows the trial cap once it is reached', () => {
    expect(
      seatIndicatorText(
        seatInput({ isTrial: true, access: access({ seatCap: 15 }), seatsInUse: 15, pendingCount: 0 }),
      ),
    ).toBe('15 of 15 seats used')
  })

  it('shows the trial cap once exceeded', () => {
    expect(
      seatIndicatorText(
        seatInput({ isTrial: true, access: access({ seatCap: 15 }), seatsInUse: 16, pendingCount: 0 }),
      ),
    ).not.toBeNull()
  })

  it('is not suppressed by isTrial once off a trial (plan_tier set)', () => {
    expect(seatIndicatorText(seatInput({ isTrial: false, seatsInUse: 2, pendingCount: 0 }))).toBe(
      '2 of 8 seats used',
    )
  })

  it('has no em dash in any copy it can produce', () => {
    const text = seatIndicatorText(seatInput({ seatsInUse: 7, pendingCount: 2 }))
    expect(text).not.toContain(EM_DASH)
  })
})

// ---------------------------------------------------------------------------
// postDeleteSeatToastMessage
// ---------------------------------------------------------------------------

function deleteInput(over: Partial<PostDeleteSeatToastInput> = {}): PostDeleteSeatToastInput {
  return {
    uiEnabled: true,
    access: access({ seatCap: 8 }),
    seatsInUseBeforeDelete: 8,
    ...over,
  }
}

describe('postDeleteSeatToastMessage', () => {
  it('renders nothing when the billing UI flag is off', () => {
    expect(postDeleteSeatToastMessage(deleteInput({ uiEnabled: false }))).toBeNull()
  })

  it('renders nothing while billing access has not loaded', () => {
    expect(postDeleteSeatToastMessage(deleteInput({ access: null }))).toBeNull()
  })

  it('renders nothing for an unlimited (comped) org, seatCap null', () => {
    expect(postDeleteSeatToastMessage(deleteInput({ access: access({ seatCap: null }) }))).toBeNull()
  })

  it('reports the pre-delete count minus one, with the exact required copy', () => {
    expect(postDeleteSeatToastMessage(deleteInput({ seatsInUseBeforeDelete: 8 }))).toBe(
      'That frees one seat. You now have 7 of 8 seats in use.',
    )
  })

  it('never reports a negative count', () => {
    expect(postDeleteSeatToastMessage(deleteInput({ seatsInUseBeforeDelete: 0 }))).toBe(
      'That frees one seat. You now have 0 of 8 seats in use.',
    )
  })

  it('has no em dash in the copy', () => {
    const msg = postDeleteSeatToastMessage(deleteInput())
    expect(msg).not.toContain(EM_DASH)
  })
})

// ---------------------------------------------------------------------------
// Wiring: OperatorCleaners.tsx cannot be mounted (no component-rendering
// setup, no @testing-library/react by standing decision). These static
// checks are the only guard that the renderer honours the models above.
// ---------------------------------------------------------------------------

/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('OperatorCleaners wiring', () => {
  const source = readFileSync(new URL('./OperatorCleaners.tsx', import.meta.url), 'utf8')
  const clean = code(source)

  it('reads billing state from useBilling, not a hand-rolled fetch or hardcoded flag', () => {
    expect(clean).toMatch(/useBilling\(\)/)
  })

  // Mutation target: the literal seat-cap string leaking into the component
  // instead of staying inside classifyInviteResult / the API route.
  it('never hand-rolls the seat_cap_reached string outside the model', () => {
    expect(clean).not.toMatch(/seat_cap_reached/)
  })

  it('classifies the invite result exactly once, via the model', () => {
    const matches = clean.match(/classifyInviteResult\(/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('extracts the handleInvite body and checks its three branches', () => {
    const body = clean.match(/const handleInvite = useCallback\(([\s\S]*?)\n {2}\);/)?.[1]
    expect(body, 'expected to find the handleInvite useCallback body').toBeTruthy()
    const b = body as string

    // Mutation target: reintroducing `toast.error(r.error || ...)` straight
    // off the raw inviteTeamMember result, which is exactly the original bug
    // (an operator reading the raw string "seat_cap_reached").
    expect(b).not.toMatch(/toast\.error\(r\.error/)

    // sent: refetches and toasts success, never opens the seat dialog.
    expect(b).toMatch(/outcome\.kind === "sent"/)

    // seat_cap: opens the seam, returns without toasting at all (original bug
    // guard: a seat-cap outcome must never reach toast.error).
    expect(b).toMatch(/outcome\.kind === "seat_cap"/)
    expect(b).toMatch(/openSeatCapDialog\(email\)/)

    // Every other error still toasts (opposite-mistake guard: a real error
    // must not be silently swallowed by the seat-cap branch).
    expect(b).toMatch(/toast\.error\(outcome\.message\)/)
  })

  it('renders the seat indicator from the model exactly once, fed real fields not literals', () => {
    const matches = clean.match(/seatIndicatorText\(\{/g) ?? []
    expect(matches.length).toBe(1)
    const call = clean.match(/seatIndicatorText\(\{([\s\S]*?)\n {4}\}\)/)?.[1]
    expect(call, 'expected to find the seatIndicatorText({...}) call body').toBeTruthy()
    const c = call as string
    for (const field of ['uiEnabled', 'access', 'seatsInUse', 'pendingCount', 'isTrial']) {
      expect(c, field).toContain(field)
    }
    // Guards against a hardcoded true/false defeating the flag check.
    expect(c).not.toMatch(/uiEnabled:\s*(true|false)/)
  })

  it('fires the post-delete seat toast from the model in the remove branch', () => {
    const removeBranch = clean.match(/if \(kind === "remove"\) \{([\s\S]*?)\n {6}\} else if/)?.[1]
    expect(removeBranch, 'expected to find the remove branch of runConfirm').toBeTruthy()
    const rb = removeBranch as string
    expect(rb).toMatch(/postDeleteSeatToastMessage\(\{/)
    // Mutation target: firing the toast unconditionally instead of gating on
    // the model's null (which encodes uiEnabled / access.seatCap).
    expect(rb).toMatch(/if \(seatMessage\)/)
  })
})
