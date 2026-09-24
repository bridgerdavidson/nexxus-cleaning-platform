// Every test below is aimed at a specific way the seat-cap dialog can be wrong
// about money or about who may spend it:
//
//   - a non-owner seeing a price or a live add-seat button (ruling R15 v4);
//   - the dialog showing the DELTA instead of the new total (ruling R17);
//   - the trial case falling through to PLANS[null] and throwing on a real,
//     reachable state (a trialing org at 15 seats);
//   - Case B offering "add a seat" on a tier that cannot hold one;
//   - a seat count committing without the confirm step;
//   - a stale or guessed total rendering while the preview is in flight.
//
// Each has a test that FAILS if the bug is reintroduced. The bottom block is
// static source guards: this repo has no component-rendering setup and
// @testing-library/react is not installed, so SeatCapDialog.tsx cannot be
// mounted, and the guards are the only check that the renderer calls these
// functions instead of restating the rules inline. They strip comments first,
// so a rule written in prose can never satisfy one. Pattern:
// billingActionParity.test.ts and seatMessagingModel.test.ts.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  priceErrorMessage,
  seatCapCaseFor,
  seatCapFallbackToast,
  seatCapNotes,
  seatCapTotalRow,
  seatPriceCents,
  seatQuoteState,
  targetSeatsFor,
  tierByName,
  type SeatCapCase,
  type SeatCapInput,
} from './seatCapDialogModel'
import { deriveBillingAccess, type BillingAccess, type OrgBillingRow } from '@/lib/billing/access'
import { PLANS, PLAN_TIERS, TRIAL_SEAT_CAP, type PlanTier } from '@/lib/billing/plans'
import { nextTierFor } from '@/lib/billing/seats'
import type { PlanPreviewPayload } from '@/app/api/billing/plan/preview/route'

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

function input(over: Partial<SeatCapInput> = {}): SeatCapInput {
  return {
    uiEnabled: true,
    access: access(),
    isOwner: true,
    tier: 'growth',
    seatCount: 8,
    seatsInUse: 8,
    period: 'monthly',
    inviteeName: 'sam@example.com',
    ...over,
  }
}

function preview(over: Partial<PlanPreviewPayload> = {}): PlanPreviewPayload {
  return {
    due_now_cents: 372,
    recurring_cents: 10900,
    next_charge_at: '2026-10-21T12:00:00.000Z',
    tax_cents: 0,
    tax_excluded: true,
    is_new_subscription: false,
    direction: 'upgrade',
    proration_date: 1_790_000_000,
    ...over,
  }
}

/** Every string a case puts on screen, for the copy-wide scans. */
function strings(c: SeatCapCase): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(c as Record<string, unknown>)) {
    if (key === 'kind') continue
    if (typeof value === 'string') out.push(value)
    if (Array.isArray(value)) {
      for (const line of value as { label?: string }[]) if (line?.label) out.push(line.label)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Case selection
// ---------------------------------------------------------------------------

describe('seatCapCaseFor: case 0 is decided FIRST', () => {
  // THE mutation target: move the trial check below either priced case and
  // PLANS[null] is undefined, so PLANS[null].maxSeats throws. This is not a
  // hypothetical state. A trialing org is NOT frozen, so assertOrgWritable
  // lets its invite through to the seat check and it really does receive the
  // 409 that opens this dialog.
  it('returns the trial case for a real trialing org at the flat cap, and does not throw', () => {
    const row: OrgBillingRow = {
      subscription_status: 'trialing',
      trial_ends_at: '2026-10-01T00:00:00.000Z',
      trial_extended_at: null,
      comped_at: null,
      plan_tier: null,
      billing_period: null,
      seat_count: null,
      subscription_cancel_at: null,
      billing_paused_at: null,
      billing_pause_resumes_at: null,
    }
    const derived = deriveBillingAccess(row, new Date('2026-09-24T00:00:00.000Z'))
    expect(derived.seatCap).toBe(TRIAL_SEAT_CAP)

    const c = seatCapCaseFor(
      input({ access: derived, tier: null, seatCount: null, period: null, seatsInUse: TRIAL_SEAT_CAP }),
    )
    expect(c.kind).toBe('trial')
    if (c.kind !== 'trial') throw new Error('unreachable')
    expect(c.title).toBe(`You have used all ${TRIAL_SEAT_CAP} trial seats`)
    expect(c.body).toBe(
      `Your trial includes ${TRIAL_SEAT_CAP} cleaner seats and all ${TRIAL_SEAT_CAP} are in use. Choose a plan to add more.`,
    )
    expect(c.confirmLabel).toBe('Choose a plan')
    expect(c.cancelLabel).toBe('Not now')
  })

  it('never produces a priced case while plan_tier is null, at any headcount', () => {
    for (const seatsInUse of [0, 1, 14, 15, 40]) {
      for (const seatCount of [null, 0, 3, 15]) {
        const c = seatCapCaseFor(
          input({ tier: null, seatCount, seatsInUse, access: access({ seatCap: TRIAL_SEAT_CAP }) }),
        )
        expect(c.kind, `seatsInUse=${seatsInUse} seatCount=${seatCount}`).toBe('trial')
        expect(JSON.stringify(c)).not.toContain('selection')
      }
    }
  })

  it('shows the trial case no price of any kind', () => {
    const c = seatCapCaseFor(input({ tier: null, seatCount: null, access: access({ seatCap: TRIAL_SEAT_CAP }) }))
    expect(strings(c).join(' ')).not.toContain('$')
  })

  it('treats an unrecognised tier as the trial case rather than pricing nothing', () => {
    // asPlanTier narrows an unknown organizations.plan_tier to null before it
    // reaches here, so this is the same door: no tier, no price.
    const c = seatCapCaseFor(input({ tier: null }))
    expect(c.kind).toBe('trial')
  })
})

describe('seatCapCaseFor: a non-owner is shown no money and given nothing to click', () => {
  const scenarios: { label: string; over: Partial<SeatCapInput> }[] = [
    { label: 'trial', over: { tier: null, seatCount: null, access: access({ seatCap: TRIAL_SEAT_CAP }) } },
    { label: 'room in the tier', over: { tier: 'growth', seatCount: 8, seatsInUse: 8 } },
    { label: 'tier full', over: { tier: 'growth', seatCount: 15, seatsInUse: 15, access: access({ seatCap: 15 }) } },
    { label: 'pro', over: { tier: 'pro', seatCount: 20, seatsInUse: 20, access: access({ seatCap: 20 }) } },
  ]

  // Mutation target: checking the tier before the role, which would hand an
  // admin a priced case (and a live Add seat button) in three of these four.
  for (const { label, over } of scenarios) {
    it(`collapses ${label} to the non-actionable dialog`, () => {
      const c = seatCapCaseFor(input({ ...over, isOwner: false }))
      expect(c.kind).toBe('non_owner')
      if (c.kind !== 'non_owner') throw new Error('unreachable')
      expect(c.title).toBe('No seats available')
      expect(c.closeLabel).toBe('Close')
      // No confirm label, no selection, no cents: the shape itself makes a
      // purchase impossible, not a role check inside the renderer.
      const json = JSON.stringify(c)
      expect(json).not.toContain('selection')
      expect(json).not.toContain('confirmLabel')
      expect(json).not.toContain('cents')
      expect(json).not.toContain('$')
    })
  }

  it('names the invitee and points at the account owner', () => {
    const c = seatCapCaseFor(input({ isOwner: false, inviteeName: 'sam@example.com' }))
    if (c.kind !== 'non_owner') throw new Error('expected non_owner')
    expect(c.body).toBe(
      'All 8 seats are in use. Ask your account owner to add a seat before inviting sam@example.com.',
    )
  })

  it('reads without a name when the invitee is unknown', () => {
    const c = seatCapCaseFor(input({ isOwner: false, inviteeName: null }))
    if (c.kind !== 'non_owner') throw new Error('expected non_owner')
    expect(c.body).toContain('before inviting anyone else.')
  })
})

describe('seatCapCaseFor: case A, room in the tier', () => {
  it('prices exactly one more seat than the org owns', () => {
    const c = seatCapCaseFor(input({ tier: 'growth', seatCount: 8, seatsInUse: 8 }))
    expect(c.kind).toBe('add_seat')
    if (c.kind !== 'add_seat') throw new Error('unreachable')
    expect(c.selection).toEqual({ tier: 'growth', period: 'monthly', seat_count: 9 })
    expect(c.title).toBe('Add a seat to invite sam@example.com?')
    expect(c.body).toBe('All 8 of your seats are in use. One more seat is $10.00 a month.')
    expect(c.confirmLabel).toBe('Add seat and invite')
    expect(c.cancelLabel).toBe('Cancel')
  })

  it('itemises the current plan and the new seat above the total', () => {
    const c = seatCapCaseFor(input({ tier: 'growth', seatCount: 8, seatsInUse: 8 }))
    if (c.kind !== 'add_seat') throw new Error('unreachable')
    expect(c.lines).toEqual([
      { label: 'Growth, 8 seats', cents: 9900 },
      { label: '1 extra seat', cents: 1000 },
    ])
    expect(c.totalLabel).toBe('New monthly total')
  })

  it('carries NO total figure of its own, only a label', () => {
    // Ruling R17 plus the rule the preview endpoint exists for. If a total in
    // cents ever appears on the case, a renderer can draw it without asking
    // Stripe, and that is how the screen and the invoice come to disagree.
    const c = seatCapCaseFor(input())
    if (c.kind !== 'add_seat') throw new Error('unreachable')
    expect(c).not.toHaveProperty('totalCents')
    expect(Object.keys(c)).not.toContain('total')
  })

  it('prices annually on an annual subscription, and labels the cadence honestly', () => {
    const c = seatCapCaseFor(input({ tier: 'growth', seatCount: 8, seatsInUse: 8, period: 'annual' }))
    if (c.kind !== 'add_seat') throw new Error('unreachable')
    expect(c.selection.period).toBe('annual')
    expect(c.body).toBe('All 8 of your seats are in use. One more seat is $120.00 a year.')
    // A yearly figure under "New monthly total" is the same mislabelling
    // ruling R21 v2 forbids on the paywall.
    expect(c.totalLabel).toBe('New yearly total')
    expect(c.lines).toEqual([
      { label: 'Growth, 8 seats', cents: 7900 * 12 },
      { label: '1 extra seat', cents: 12000 },
    ])
  })

  it('covers an over-occupied org rather than quoting a seat count the API would refuse', () => {
    // The send-invite route fails OPEN on a failed seat count and the spec
    // accepts an over-cap race, so seatsInUse really can exceed seat_count.
    // seat_count + 1 would then be below seatsInUse, and both the preview and
    // the apply route reject that with a 400.
    const c = seatCapCaseFor(input({ tier: 'growth', seatCount: 8, seatsInUse: 10 }))
    if (c.kind !== 'add_seat') throw new Error('unreachable')
    expect(c.selection.seat_count).toBe(11)
    expect(c.lines[1]).toEqual({ label: '3 extra seats', cents: 3000 })
    expect(c.confirmLabel).toBe('Add seats and invite')
  })

  it('never asks for fewer seats than the tier includes', () => {
    const c = seatCapCaseFor(input({ tier: 'growth', seatCount: 2, seatsInUse: 2, access: access({ seatCap: 2 }) }))
    if (c.kind !== 'add_seat') throw new Error('unreachable')
    expect(c.selection.seat_count).toBe(PLANS.growth.includedSeats)
  })

  it('falls back to the cap when a tier is stored with no seat count', () => {
    const c = seatCapCaseFor(input({ tier: 'growth', seatCount: null, access: access({ seatCap: 9 }), seatsInUse: 9 }))
    if (c.kind !== 'add_seat') throw new Error('unreachable')
    expect(c.selection.seat_count).toBe(10)
  })
})

describe('seatCapCaseFor: case B, the tier is full', () => {
  it('offers the UPGRADE, never another seat, when the tier is at its ceiling', () => {
    // Mutation target: comparing seat_count < maxSeats loosely, or dropping
    // the ceiling check, which offers a seat the apply route rejects outright.
    const c = seatCapCaseFor(
      input({ tier: 'growth', seatCount: 15, seatsInUse: 15, access: access({ seatCap: 15 }) }),
    )
    expect(c.kind).toBe('upgrade')
    if (c.kind !== 'upgrade') throw new Error('unreachable')
    expect(c.selection.tier).toBe('pro')
    expect(c.confirmLabel).toBe('Move to Pro')
    expect(c.confirmLabel).not.toContain('seat')
    expect(c.title).toBe('Growth is full')
    expect(c.body).toBe(
      'Growth holds a maximum of 15 seats and all 15 are in use. Pro has no seat limit.',
    )
  })

  it('moves a full Starter to Growth at the seats Growth includes', () => {
    const c = seatCapCaseFor(
      input({ tier: 'starter', seatCount: 5, seatsInUse: 5, access: access({ seatCap: 5 }) }),
    )
    if (c.kind !== 'upgrade') throw new Error('expected upgrade')
    expect(c.selection).toEqual({ tier: 'growth', period: 'monthly', seat_count: 8 })
    expect(c.body).toBe(
      'Starter holds a maximum of 5 seats and all 5 are in use. Growth covers up to 15 cleaners.',
    )
    expect(c.lines).toEqual([
      { label: 'Starter today, 5 seats', cents: 3900 + 2 * 1000 },
      { label: 'Growth, 8 seats', cents: 9900 },
    ])
    // The comparison is plan to plan, both sides catalogue, so it cannot
    // disagree with itself. The prominent total still comes from the preview.
    expect(c.comparison).toBe('Growth is $40.00 more a month than Starter.')
  })

  it('carries no total figure of its own either', () => {
    const c = seatCapCaseFor(
      input({ tier: 'growth', seatCount: 15, seatsInUse: 15, access: access({ seatCap: 15 }) }),
    )
    if (c.kind !== 'upgrade') throw new Error('unreachable')
    expect(c).not.toHaveProperty('totalCents')
    expect(c.totalLabel).toBe('New monthly total')
  })

  it('never fires on Pro, whose seat ceiling is null', () => {
    for (const seatCount of [15, 40, 500]) {
      const c = seatCapCaseFor(
        input({ tier: 'pro', seatCount, seatsInUse: seatCount, access: access({ seatCap: seatCount }) }),
      )
      expect(c.kind, `pro at ${seatCount}`).toBe('add_seat')
    }
  })

  // The brief allows Case B to fall back to Case A when no higher tier exists.
  // This proves that fallback is unreachable rather than trusting it: for
  // every tier that HAS a ceiling, nextTierFor names a real higher tier.
  it('always resolves a higher tier for every capped tier at its ceiling', () => {
    for (const tier of PLAN_TIERS) {
      const max = PLANS[tier].maxSeats
      if (max == null) continue
      const name = nextTierFor(max, tier)
      expect(name, `${tier} at ${max}`).toBeTruthy()
      const key = tierByName(name)
      expect(key, `${tier} -> ${name}`).toBeTruthy()
      expect(PLAN_TIERS.indexOf(key as PlanTier)).toBeGreaterThan(PLAN_TIERS.indexOf(tier))
    }
  })
})

describe('seatCapCaseFor: the dialog cannot render', () => {
  it('is unavailable while the billing UI flag is dark', () => {
    expect(seatCapCaseFor(input({ uiEnabled: false })).kind).toBe('unavailable')
  })

  it('is unavailable while billing state is unreadable', () => {
    expect(seatCapCaseFor(input({ access: null })).kind).toBe('unavailable')
  })

  it('is unavailable for a comped org, whose null cap means unlimited', () => {
    expect(seatCapCaseFor(input({ access: access({ state: 'comped', seatCap: null }) })).kind).toBe(
      'unavailable',
    )
  })

  it('checks the flag before the role, so no case is built on a dark flag', () => {
    expect(seatCapCaseFor(input({ uiEnabled: false, isOwner: false })).kind).toBe('unavailable')
  })
})

describe('seatCapCaseFor: copy rules', () => {
  // Built lazily, inside each test: a throw from seatCapCaseFor (which is
  // exactly what reordering the trial check produces) must surface as a named
  // failing test, not as a whole-file collection error.
  const everyCase = (): SeatCapCase[] => [
    seatCapCaseFor(input({ tier: null, seatCount: null, access: access({ seatCap: TRIAL_SEAT_CAP }) })),
    seatCapCaseFor(input({ isOwner: false })),
    seatCapCaseFor(input()),
    seatCapCaseFor(input({ period: 'annual' })),
    seatCapCaseFor(input({ tier: 'growth', seatCount: 15, seatsInUse: 15, access: access({ seatCap: 15 }) })),
    seatCapCaseFor(input({ tier: 'starter', seatCount: 5, seatsInUse: 5, access: access({ seatCap: 5 }) })),
  ]

  it('uses no em dash anywhere', () => {
    for (const c of everyCase()) {
      for (const s of strings(c)) expect(s, s).not.toContain(EM_DASH)
    }
  })

  it('never leaks a machine string into the copy', () => {
    for (const c of everyCase()) {
      const joined = strings(c).join(' ')
      expect(joined).not.toContain('seat_cap_reached')
      expect(joined).not.toContain('billing_payment_required')
      expect(joined).not.toContain('seat_count')
      expect(joined).not.toContain('undefined')
      expect(joined).not.toContain('NaN')
    }
  })

  it('gives every actionable case both a cancel and a confirm label', () => {
    for (const c of everyCase()) {
      if (c.kind === 'unavailable' || c.kind === 'non_owner') continue
      expect(c.cancelLabel.length, c.title).toBeGreaterThan(0)
      expect(c.confirmLabel.length, c.title).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// targetSeatsFor / tierByName / seatPriceCents
// ---------------------------------------------------------------------------

describe('targetSeatsFor', () => {
  it('asks for one more than the org owns', () => {
    expect(targetSeatsFor('growth', 8, 8)).toBe(9)
  })

  it('covers an over-occupied org', () => {
    expect(targetSeatsFor('growth', 8, 12)).toBe(13)
  })

  it('never falls below the tier included count', () => {
    expect(targetSeatsFor('pro', 1, 1)).toBe(PLANS.pro.includedSeats)
  })
})

describe('tierByName', () => {
  it('resolves the NAME nextTierFor returns back to a tier key', () => {
    expect(tierByName('Growth')).toBe('growth')
    expect(tierByName('Pro')).toBe('pro')
  })

  it('refuses a lower-cased guess rather than resolving it', () => {
    // nextTierFor returns PLANS[tier].name, not the key. A renderer that
    // assumed otherwise would build a selection out of a display string.
    expect(tierByName('growth')).toBeNull()
    expect(tierByName(null)).toBeNull()
    expect(tierByName('Enterprise')).toBeNull()
  })
})

describe('seatPriceCents', () => {
  it('is the yearly seat price on an annual subscription, not a twelfth of it', () => {
    expect(seatPriceCents('monthly')).toBe(1000)
    expect(seatPriceCents('annual')).toBe(12000)
  })
})

// ---------------------------------------------------------------------------
// The total: ruling R17
// ---------------------------------------------------------------------------

describe('seatCapTotalRow', () => {
  it('is the NEW recurring total, never the delta and never the amount due now', () => {
    // Mutation target: returning recurring - current (the delta), or
    // due_now_cents. Both are numbers a reasonable-looking implementation
    // could return, and both are the ClickUp/Loom complaint pattern.
    const p = preview({ recurring_cents: 10900, due_now_cents: 372 })
    const row = seatCapTotalRow(p, 'New monthly total')
    expect(row.cents).toBe(10900)
    expect(row.cents).not.toBe(372)
    expect(row.cents).not.toBe(1000)
    expect(row.label).toBe('New monthly total')
  })

  it('still shows the new total when nothing is charged today', () => {
    const row = seatCapTotalRow(preview({ due_now_cents: 0, recurring_cents: 10900 }), 'New monthly total')
    expect(row.cents).toBe(10900)
  })

  it('clamps a negative figure rather than printing one', () => {
    expect(seatCapTotalRow(preview({ recurring_cents: -500 }), 'x').cents).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The quote gate
// ---------------------------------------------------------------------------

describe('seatQuoteState', () => {
  const base = { needsQuote: true, isFetching: false, error: null, data: preview(), submitting: false }

  it('withholds a CACHED total while a refetch is in flight', () => {
    // THE mutation target for "a stale total rendering while the preview is in
    // flight". TanStack Query keeps the previous data for a key across a
    // refetch; drawing it is how the screen shows one number while Stripe is
    // computing another.
    const q = seatQuoteState({ ...base, isFetching: true })
    expect(q.status).toBe('pending')
    expect(q.preview).toBeNull()
    expect(q.canConfirm).toBe(false)
  })

  it('refuses to confirm when the quote failed', () => {
    const q = seatQuoteState({ ...base, error: new Error('nope'), data: undefined })
    expect(q.status).toBe('error')
    expect(q.preview).toBeNull()
    expect(q.canConfirm).toBe(false)
  })

  it('refuses to confirm, and shows nothing, before any data arrives', () => {
    const q = seatQuoteState({ ...base, data: undefined })
    expect(q.status).toBe('pending')
    expect(q.preview).toBeNull()
    expect(q.canConfirm).toBe(false)
  })

  it('hands over the preview only once it has settled', () => {
    const q = seatQuoteState(base)
    expect(q.status).toBe('ready')
    expect(q.preview).toEqual(preview())
    expect(q.canConfirm).toBe(true)
  })

  it('blocks a second confirm while the first is still applying', () => {
    expect(seatQuoteState({ ...base, submitting: true }).canConfirm).toBe(false)
  })

  it('needs no quote for the cases that show no money', () => {
    const q = seatQuoteState({ ...base, needsQuote: false, data: undefined })
    expect(q.status).toBe('ready')
    expect(q.preview).toBeNull()
    expect(q.canConfirm).toBe(true)
  })

  it('prefers an error over stale data even when both are present', () => {
    const q = seatQuoteState({ ...base, error: new Error('nope') })
    expect(q.preview).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The supporting sentences: ruling R21 v2
// ---------------------------------------------------------------------------

describe('seatCapNotes', () => {
  it('states the amount charged today when the preview says money is due', () => {
    const notes = seatCapNotes({ preview: preview({ due_now_cents: 372 }), inviteeName: 'sam@example.com' })
    expect(notes[0]).toBe('$3.72 is charged today, for the rest of your current billing period.')
    expect(notes[1]).toBe('sam@example.com can start right away.')
  })

  it('never implies a charge when the computed amount is zero', () => {
    // Mutation target: a fixed "A prorated amount is charged today" sentence,
    // which is the StubHub surprise in reverse. The copy follows the number.
    const notes = seatCapNotes({ preview: preview({ due_now_cents: 0 }), inviteeName: 'sam@example.com' })
    expect(notes[0]).toBe('Nothing is charged today. The new total starts on October 21, 2026.')
    expect(notes.join(' ')).not.toContain('charged today, for the rest')
  })

  it('falls back to "your next invoice" when Stripe gave no date', () => {
    const notes = seatCapNotes({ preview: preview({ due_now_cents: 0, next_charge_at: null }), inviteeName: null })
    expect(notes[0]).toBe('Nothing is charged today. The new total starts on your next invoice.')
    expect(notes[1]).toBe('Your new cleaner can start right away.')
  })

  it('says the charge happens at checkout when there is no live subscription', () => {
    // The apply route hands back a hosted Checkout URL in this case, so the
    // browser leaves the screen. Promising immediate access would be false.
    const notes = seatCapNotes({
      preview: preview({ is_new_subscription: true, due_now_cents: 10900 }),
      inviteeName: 'sam@example.com',
    })
    expect(notes[0]).toBe('$109.00 is due at checkout, on a secure Stripe payment page.')
    expect(notes[1]).toBe('sam@example.com can start as soon as that payment goes through.')
    expect(notes.join(' ')).not.toContain('right away')
  })

  it('admits the quote excludes tax while the tax flag is off', () => {
    expect(seatCapNotes({ preview: preview({ tax_excluded: true }), inviteeName: null })).toContain(
      'Sales tax is calculated at checkout.',
    )
    expect(
      seatCapNotes({ preview: preview({ tax_excluded: false }), inviteeName: null }).join(' '),
    ).not.toContain('Sales tax')
  })

  it('uses no em dash', () => {
    for (const p of [preview(), preview({ due_now_cents: 0 }), preview({ is_new_subscription: true })]) {
      for (const note of seatCapNotes({ preview: p, inviteeName: 'sam@example.com' })) {
        expect(note).not.toContain(EM_DASH)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Errors and the no-dialog fallback
// ---------------------------------------------------------------------------

describe('priceErrorMessage', () => {
  it('translates the past_due refusal instead of printing the machine string', () => {
    const msg = priceErrorMessage(new Error('billing_payment_required'))
    expect(msg).toBe('Please update your payment method before adding a seat.')
    expect(msg).not.toContain('billing_payment_required')
  })

  it('falls back to a plain retryable message', () => {
    expect(priceErrorMessage(new Error('boom'))).toBe('Could not price this change. Please try again.')
    expect(priceErrorMessage(null)).toBe('Could not price this change. Please try again.')
  })
})

describe('seatCapFallbackToast', () => {
  it('says nothing when the dialog itself can render', () => {
    expect(seatCapFallbackToast({ uiEnabled: true, access: access(), inviteeName: 'sam@example.com' })).toBeNull()
  })

  it('answers the operator when the dialog cannot render at all', () => {
    // The server 409 is gated by BILLING_ENFORCEMENT_ENABLED and the dialog by
    // the NEXT_PUBLIC_ mirror. Two variables can drift, and the failure mode
    // is the one this whole task exists to end: click Send invite, get nothing.
    const msg = seatCapFallbackToast({ uiEnabled: false, access: access(), inviteeName: 'sam@example.com' })
    expect(msg).toBe('All of your cleaner seats are in use, so sam@example.com could not be invited.')
    expect(msg).not.toContain('$')
    expect(msg).not.toContain(EM_DASH)
  })

  it('also answers when billing state is unreadable', () => {
    expect(seatCapFallbackToast({ uiEnabled: true, access: null, inviteeName: null })).toContain(
      'could not be invited',
    )
  })
})

// ---------------------------------------------------------------------------
// Wiring: what the renderers actually do.
//
// Read with comments stripped, so a rule stated in prose can never satisfy a
// guard.
// ---------------------------------------------------------------------------

function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const dialogSource = code(readFileSync(new URL('./SeatCapDialog.tsx', import.meta.url), 'utf8'))
const cleanersSource = code(
  readFileSync(new URL('../cleaners/OperatorCleaners.tsx', import.meta.url), 'utf8'),
)

describe('SeatCapDialog.tsx wiring', () => {
  it('decides the case in the model, exactly once, from real inputs', () => {
    expect((dialogSource.match(/seatCapCaseFor\(\{/g) ?? []).length).toBe(1)
    const call = dialogSource.match(/seatCapCaseFor\(\{([\s\S]*?)\n {2}\}\)/)?.[1]
    expect(call, 'expected the seatCapCaseFor({...}) call body').toBeTruthy()
    for (const field of ['uiEnabled', 'access', 'isOwner', 'tier', 'seatCount', 'seatsInUse', 'period']) {
      expect(call as string, field).toContain(field)
    }
    // Mutation target: a hardcoded literal defeating the flag or the role gate.
    expect(call as string).not.toMatch(/uiEnabled:\s*(true|false)/)
    expect(call as string).not.toMatch(/isOwner:\s*(true|false)/)
  })

  it('does no plan arithmetic of its own', () => {
    // Every tier lookup, seat count and price belongs in the model, where a
    // test can reach it.
    expect(dialogSource).not.toContain('PLANS[')
    expect(dialogSource).not.toContain('EXTRA_SEAT')
    expect(dialogSource).not.toContain('planChargeCents')
    expect(dialogSource).not.toContain('nextTierFor')
    expect(dialogSource).not.toMatch(/seat_count:\s*\w+\s*\+/)
  })

  it('branches on the role only through the model', () => {
    // Mutation target: an `isOwner ? ... : ...` in the JSX, which is how a
    // price reaches a non-owner without the model ever knowing.
    expect((dialogSource.match(/isOwner/g) ?? []).length).toBe(2)
    expect(dialogSource).not.toMatch(/isOwner\s*\?/)
    expect(dialogSource).not.toMatch(/isOwner\s*&&/)
  })

  it('renders nothing at all when the model says the dialog cannot render', () => {
    expect(dialogSource).toMatch(/seatCase\.kind === 'unavailable'\) return null/)
  })

  it('draws every figure from the settled quote, never from the raw query data', () => {
    // previewQuery.data appears once, as an argument to the gate. Anything
    // else is a number drawn before the quote settled.
    expect((dialogSource.match(/previewQuery\.data/g) ?? []).length).toBe(1)
    expect(dialogSource).toMatch(/data:\s*previewQuery\.data/)
    expect(dialogSource).toMatch(/quote\.preview\s*\?\s*seatCapTotalRow\(quote\.preview/)
    expect(dialogSource).toMatch(/quote\.preview\s*\?\s*seatCapNotes\(\{\s*preview:\s*quote\.preview/)
    // The skeleton is the only alternative to a settled total.
    expect(dialogSource).toContain('<Skeleton')
  })

  it('never computes a total in the renderer', () => {
    expect(dialogSource).not.toMatch(/due_now_cents/)
    expect(dialogSource).not.toMatch(/recurring_cents/)
    expect(dialogSource).not.toMatch(/reduce\(/)
  })

  /**
   * What handleConfirm is allowed to send: the SAME selection object that was
   * priced, plus the instant it was priced at. Anything else in that object
   * means the dialog quoted one thing and bought another, which is the bug
   * these guards exist to catch.
   */
  const APPLIED_SELECTION =
    /changePlan\(orgId, \{\s*\.\.\.selection,\s*proration_date: quote\.preview\.proration_date,?\s*\}\)/

  it('commits the seat ONLY from the confirm handler', () => {
    // Mutation target: an effect, or a call on open, that buys a seat without
    // the operator confirming the price.
    expect((dialogSource.match(/changePlan\(/g) ?? []).length).toBe(1)
    const body = dialogSource.match(/async function handleConfirm\(\): Promise<void> \{([\s\S]*?)\n {2}\}/)
    expect(body, 'handleConfirm not found in SeatCapDialog.tsx').not.toBeNull()
    // The applied body is `selection` spread, plus proration_date read straight
    // off the settled quote, and NOTHING else. Written as one exact shape so a
    // fourth key (or a re-derived tier/seat count) cannot slip in beside it.
    expect(body![1]).toMatch(APPLIED_SELECTION)
    // Nothing fires on its own: no effect anywhere in the file.
    expect(dialogSource).not.toContain('useEffect')
    // And the confirm button is the only thing that calls it.
    expect(dialogSource).toMatch(/onClick=\{\(\) => void handleConfirm\(\)\}/)
  })

  it('refuses to confirm at an unknown price, twice over', () => {
    const body = dialogSource.match(/async function handleConfirm\(\): Promise<void> \{([\s\S]*?)\n {2}\}/)![1]
    expect(body).toMatch(/if \(!selection \|\| !quote\.preview\) return/)
    expect(dialogSource).toMatch(/disabled=\{!quote\.canConfirm\}/)
  })

  it('prices and applies the SAME selection object', () => {
    // Mutation target: previewing one seat count and applying another, which
    // is how the quote and the invoice come apart.
    expect(dialogSource).toMatch(/previewPlan\(orgId, selection!\)/)
    expect(dialogSource).toMatch(APPLIED_SELECTION)
    expect((dialogSource.match(/previewPlan\(/g) ?? []).length).toBe(1)
  })

  it('does not quote a price for a case that has no selection', () => {
    expect(dialogSource).toMatch(/enabled: open && !!orgId && !!selection/)
  })

  it('invalidates billing and retries the invite after a successful add', () => {
    const body = dialogSource.match(/async function handleConfirm\(\): Promise<void> \{([\s\S]*?)\n {2}\}/)![1]
    expect(body).toContain('keys.billing.all')
    expect(body).toContain('onSeatAdded()')
    // Hosted Checkout leaves the page, so the retry must not run there.
    expect(body).toMatch(/checkout_url[\s\S]*?window\.location\.href[\s\S]*?return/)
  })

  it('uses design-system tokens only', () => {
    expect(dialogSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(dialogSource).not.toMatch(/style=\{\{/)
  })

  // Touch-target rule: "Try again" renders as a real button (outline), so it
  // must be >=44px (size="default"), not the 36px size="sm".
  it('renders "Try again" at the 44px default size, not size="sm"', () => {
    expect(dialogSource).not.toMatch(/size="sm"/)
  })

  it('puts no em dash in any user-facing string', () => {
    expect(dialogSource).not.toContain(EM_DASH)
  })
})

describe('OperatorCleaners.tsx wiring', () => {
  it('mounts the dialog with the invitee and the retry', () => {
    expect(cleanersSource).toMatch(/<SeatCapDialog/)
    expect(cleanersSource).toMatch(/inviteeName=\{seatCapInvitee\}/)
    expect(cleanersSource).toMatch(/onSeatAdded=\{retryInviteAfterSeat\}/)
    expect(cleanersSource).toMatch(/open=\{seatCapInvitee !== null\}/)
  })

  it('opens the dialog from the seat-cap branch, and never toasts a raw error there', () => {
    // The seam the plumbing task left: still called with the invitee's email.
    expect(cleanersSource).toMatch(/openSeatCapDialog\(email\)/)
    expect(cleanersSource).not.toMatch(/seat_cap_reached/)
  })

  it('still answers the operator when the dialog cannot render', () => {
    // Mutation target: dropping the fallback, which silently restores the
    // original bug (click Send invite, nothing happens) whenever the server
    // flag is on and the NEXT_PUBLIC_ mirror is off.
    const body = cleanersSource.match(/const openSeatCapDialog = useCallback\(([\s\S]*?)\n {2}\);/)?.[1]
    expect(body, 'openSeatCapDialog not found').toBeTruthy()
    expect(body as string).toContain('seatCapFallbackToast({')
    expect(body as string).toMatch(/if \(fallback\) \{[\s\S]*?toast\.error\(fallback\)/)
    expect(body as string).toContain('setSeatCapInvitee(inviteeName)')
  })

  it('retries the exact invite that was refused', () => {
    // Ruling R16: losing the invite they were writing is the thing this whole
    // dialog exists to prevent.
    const body = cleanersSource.match(/const retryInviteAfterSeat = useCallback\(([\s\S]*?)\n {2}\}, \[/)?.[1]
    expect(body, 'retryInviteAfterSeat not found').toBeTruthy()
    expect(body as string).toContain('handleInvite(email)')
    expect(body as string).toMatch(/if \(sent\) setAddOpen\(false\)/)
  })
})
