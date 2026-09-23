import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  buildTierOptions,
  cancelNoteFor,
  clampSeats,
  defaultTierFor,
  initialPeriodFor,
  initialSeatsFor,
  planLines,
  prorationNoteFor,
  renewalNoteFor,
  seatFloorFor,
  seatHelperText,
  seatMinReasonFor,
  seatRangeFor,
  quoteStateFor,
  taxNoteFor,
  totalRowFor,
} from './planPickerModel'
import {
  PLANS,
  PLAN_TIERS,
  planChargeCents,
  type BillingPeriod,
  type PlanTier,
} from '@/lib/billing/plans'
import type { PlanPreviewPayload } from '@/app/api/billing/plan/preview/route'

const EM_DASH = '—'

function preview(over: Partial<PlanPreviewPayload> = {}): PlanPreviewPayload {
  return {
    due_now_cents: 3780,
    recurring_cents: 9900,
    next_charge_at: '2026-10-21T00:00:00.000Z',
    tax_cents: 0,
    tax_excluded: true,
    is_new_subscription: false,
    direction: 'upgrade',
    ...over,
  }
}

describe('defaultTierFor', () => {
  it('pre-selects the smallest tier that fits the headcount (ruling R5)', () => {
    expect(defaultTierFor(2, null)).toBe('starter')
    expect(defaultTierFor(6, null)).toBe('growth')
    expect(defaultTierFor(16, null)).toBe('pro')
  })
  it('keeps the current tier when it still fits', () => {
    expect(defaultTierFor(2, 'growth')).toBe('growth')
  })
  it('moves up when the current tier no longer fits', () => {
    expect(defaultTierFor(9, 'starter')).toBe('growth')
  })

  // Strengthening: a constant return, or an off-by-one on the cap, survives the
  // three cases above. This walks every headcount across both boundaries.
  it('never pre-selects a tier the headcount does not fit, at any headcount', () => {
    for (let seats = 0; seats <= 40; seats++) {
      const tier = defaultTierFor(seats, null)
      const max = PLANS[tier].maxSeats
      expect(max === null || seats <= max, `seats=${seats} picked ${tier}`).toBe(true)
    }
  })
  it('picks exactly at each cap boundary', () => {
    expect(defaultTierFor(5, null)).toBe('starter')
    expect(defaultTierFor(15, null)).toBe('growth')
  })
  it('does not downgrade a bigger current tier that still fits', () => {
    expect(defaultTierFor(1, 'pro')).toBe('pro')
  })
})

describe('buildTierOptions', () => {
  it('marks a tier too small for the headcount unavailable, with a reason', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 6, currentTier: null })
    const starter = opts.find((o) => o.tier === 'starter')!
    expect(starter.available).toBe(false)
    expect(starter.unavailableReason).toBe('Too small for your 6 cleaners')
  })

  it('leaves a tier that fits available with no reason', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 6, currentTier: null })
    const growth = opts.find((o) => o.tier === 'growth')!
    expect(growth.available).toBe(true)
    expect(growth.unavailableReason).toBeUndefined()
  })

  it('states the fit reason factually on the default tier', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 6, currentTier: null })
    expect(opts.find((o) => o.tier === 'growth')!.fitReason).toBe('Fits your 6 cleaners')
  })

  it('uses singular wording for one cleaner', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 1, currentTier: null })
    expect(opts.find((o) => o.tier === 'starter')!.fitReason).toBe('Fits your 1 cleaner')
  })

  it('prices annual as the per-month equivalent', () => {
    const monthly = buildTierOptions({ period: 'monthly', seatsInUse: 1, currentTier: null })
    const annual = buildTierOptions({ period: 'annual', seatsInUse: 1, currentTier: null })
    expect(monthly.find((o) => o.tier === 'growth')!.priceCents).toBe(9900)
    expect(annual.find((o) => o.tier === 'growth')!.priceCents).toBe(7900)
  })

  it('contains no em dash in any generated string', () => {
    for (const p of ['monthly', 'annual'] as const) {
      for (const seats of [1, 6, 16]) {
        for (const o of buildTierOptions({ period: p, seatsInUse: seats, currentTier: null })) {
          expect(o.unavailableReason ?? '').not.toContain(EM_DASH)
          expect(o.fitReason ?? '').not.toContain(EM_DASH)
        }
      }
    }
  })

  // --- Strengthening below. Everything above passes against implementations
  // that hardcode names, seat counts, or badge every tier as the fit.

  it('returns every tier once, in catalogue order', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 3, currentTier: null })
    expect(opts.map((o) => o.tier)).toEqual(PLAN_TIERS)
  })

  it('mirrors the catalogue name, included seats and cap for every tier', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 3, currentTier: null })
    for (const o of opts) {
      expect(o.name).toBe(PLANS[o.tier].name)
      expect(o.includedSeats).toBe(PLANS[o.tier].includedSeats)
      expect(o.maxSeats).toBe(PLANS[o.tier].maxSeats)
    }
  })

  it('prices every tier from the catalogue at both periods', () => {
    for (const period of ['monthly', 'annual'] as const) {
      for (const o of buildTierOptions({ period, seatsInUse: 1, currentTier: null })) {
        const expected =
          period === 'annual' ? PLANS[o.tier].annualMonthlyCents : PLANS[o.tier].monthlyCents
        expect(o.priceCents, `${o.tier} ${period}`).toBe(expected)
      }
    }
  })

  it('labels exactly one tier as the fit, never every tier (ruling R5)', () => {
    for (const seats of [1, 4, 6, 12, 16, 40]) {
      const withFit = buildTierOptions({ period: 'monthly', seatsInUse: seats, currentTier: null })
        .filter((o) => o.fitReason)
      expect(withFit, `seats=${seats}`).toHaveLength(1)
      expect(withFit[0].tier).toBe(defaultTierFor(seats, null))
    }
  })

  it('puts the fit label on the current tier when one is already held', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 2, currentTier: 'growth' })
    expect(opts.find((o) => o.tier === 'growth')!.fitReason).toBe('Fits your 2 cleaners')
    expect(opts.find((o) => o.tier === 'starter')!.fitReason).toBeUndefined()
  })

  it('states no headcount fit when the org has no cleaners yet', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 0, currentTier: null })
    expect(opts.every((o) => o.fitReason === undefined)).toBe(true)
    expect(opts.every((o) => o.available)).toBe(true)
  })

  it('marks every tier below the headcount unavailable, not only the first', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 16, currentTier: null })
    expect(opts.find((o) => o.tier === 'starter')!.available).toBe(false)
    expect(opts.find((o) => o.tier === 'growth')!.available).toBe(false)
    expect(opts.find((o) => o.tier === 'pro')!.available).toBe(true)
  })

  it('keeps an uncapped tier available at any headcount', () => {
    const opts = buildTierOptions({ period: 'monthly', seatsInUse: 500, currentTier: null })
    expect(opts.find((o) => o.tier === 'pro')!.available).toBe(true)
  })
})

describe('seatFloorFor', () => {
  it('floors at the greater of included seats and seats in use', () => {
    expect(seatFloorFor('growth', 3)).toBe(8)   // 8 included
    expect(seatFloorFor('growth', 11)).toBe(11) // headcount exceeds included
    expect(seatFloorFor('starter', 1)).toBe(3)
  })

  it('applies to every tier, including the uncapped one', () => {
    expect(seatFloorFor('pro', 2)).toBe(15)
    expect(seatFloorFor('pro', 40)).toBe(40)
    expect(seatFloorFor('starter', 5)).toBe(5)
  })
})

describe('clampSeats', () => {
  it('raises a request below the floor up to the floor', () => {
    expect(clampSeats({ tier: 'growth', seatsInUse: 3, desired: 1 })).toBe(8)
    expect(clampSeats({ tier: 'growth', seatsInUse: 11, desired: 9 })).toBe(11)
  })
  it('holds a request inside the range unchanged', () => {
    expect(clampSeats({ tier: 'growth', seatsInUse: 3, desired: 12 })).toBe(12)
  })
  it('caps a request above the tier maximum', () => {
    expect(clampSeats({ tier: 'growth', seatsInUse: 3, desired: 99 })).toBe(15)
    expect(clampSeats({ tier: 'starter', seatsInUse: 1, desired: 99 })).toBe(5)
  })
  it('does not cap the uncapped tier', () => {
    expect(clampSeats({ tier: 'pro', seatsInUse: 3, desired: 99 })).toBe(99)
  })
})

describe('initialSeatsFor', () => {
  it('starts at the floor when nothing is owned yet', () => {
    expect(initialSeatsFor({ tier: 'growth', seatsInUse: 3, currentSeats: null })).toBe(8)
  })
  it('keeps the seats already paid for when they are above the floor', () => {
    expect(initialSeatsFor({ tier: 'growth', seatsInUse: 3, currentSeats: 12 })).toBe(12)
  })
  it('never carries owned seats past a smaller tier maximum', () => {
    expect(initialSeatsFor({ tier: 'starter', seatsInUse: 2, currentSeats: 12 })).toBe(5)
  })
  it('never drops below the headcount', () => {
    expect(initialSeatsFor({ tier: 'growth', seatsInUse: 11, currentSeats: 8 })).toBe(11)
  })
})

describe('initialPeriodFor', () => {
  // Ruling R4. The single most consequential default in this component.
  it('defaults to monthly when nothing is owned yet (ruling R4)', () => {
    expect(initialPeriodFor(null)).toBe('monthly')
  })
  it('keeps the period already being paid for', () => {
    expect(initialPeriodFor('annual')).toBe('annual')
    expect(initialPeriodFor('monthly')).toBe('monthly')
  })
})

describe('planLines', () => {
  it('splits the charge into a base line and a seat line that sum to the charge', () => {
    for (const tier of PLAN_TIERS) {
      for (const period of ['monthly', 'annual'] as const) {
        for (const extra of [0, 1, 4]) {
          const seatCount = PLANS[tier].includedSeats + extra
          const lines = planLines({ tier, period, seatCount })
          expect(
            lines.base.cents + lines.seats.cents,
            `${tier} ${period} ${seatCount}`,
          ).toBe(planChargeCents(tier, period, seatCount))
        }
      }
    }
  })

  it('charges nothing for seats inside the included count', () => {
    const lines = planLines({ tier: 'growth', period: 'monthly', seatCount: 8 })
    expect(lines.seats.cents).toBe(0)
    expect(lines.base.cents).toBe(9900)
  })

  it('bills the real per-period amount, not the monthly-equivalent, on annual', () => {
    const lines = planLines({ tier: 'growth', period: 'annual', seatCount: 10 })
    expect(lines.base.cents).toBe(7900 * 12)
    expect(lines.seats.cents).toBe(12000 * 2)
  })

  it('names the period in the base label and the seat split in the seat label', () => {
    const monthly = planLines({ tier: 'growth', period: 'monthly', seatCount: 10 })
    expect(monthly.base.label).toBe('Growth, monthly')
    expect(monthly.seats.label).toBe('10 seats, 8 included')
    const annual = planLines({ tier: 'starter', period: 'annual', seatCount: 3 })
    expect(annual.base.label).toBe('Starter, yearly')
    expect(annual.seats.label).toBe('3 seats, 3 included')
  })
})

describe('totalRowFor', () => {
  // Ruling R21. One blanket "Due today" is wrong half the time.
  it('labels an upgrade as charged today, using the due-now figure', () => {
    const row = totalRowFor(preview({ direction: 'upgrade', due_now_cents: 3780, recurring_cents: 9900 }))
    expect(row.label).toBe('Charged today')
    expect(row.cents).toBe(3780)
  })

  it('labels a downgrade as a credit and shows the new recurring figure, never a today figure', () => {
    const row = totalRowFor(preview({ direction: 'downgrade', due_now_cents: 0, recurring_cents: 3900 }))
    expect(row.label).toBe('Credited to your next invoice')
    expect(row.cents).toBe(3900)
  })

  it('shows no amount at all when nothing changes', () => {
    const row = totalRowFor(preview({ direction: 'unchanged', due_now_cents: 0, recurring_cents: 9900 }))
    expect(row.label).toBe('Your bill does not change')
    expect(row.cents).toBeNull()
  })

  it('gives each direction a distinct label', () => {
    const labels = (['upgrade', 'downgrade', 'unchanged'] as const).map(
      (direction) => totalRowFor(preview({ direction })).label,
    )
    expect(new Set(labels).size).toBe(3)
  })

  it('never says due or charged today on a downgrade', () => {
    const row = totalRowFor(preview({ direction: 'downgrade' }))
    expect(row.label.toLowerCase()).not.toContain('today')
  })
})

describe('renewalNoteFor', () => {
  it('states the next amount and date after an upgrade', () => {
    expect(
      renewalNoteFor({
        preview: preview({ direction: 'upgrade', recurring_cents: 9900 }),
        period: 'monthly',
      }),
    ).toBe('Then $99.00 on October 21, 2026.')
  })

  it('says nothing is charged today on a downgrade, with the date it takes effect', () => {
    expect(
      renewalNoteFor({
        preview: preview({ direction: 'downgrade', recurring_cents: 3900 }),
        period: 'monthly',
      }),
    ).toBe('Nothing is charged today. Your plan changes to this price on October 21, 2026.')
  })

  it('falls back to the cadence when Stripe supplied no date', () => {
    expect(
      renewalNoteFor({
        preview: preview({ next_charge_at: null, recurring_cents: 9900, is_new_subscription: true }),
        period: 'monthly',
      }),
    ).toBe('Then $99.00 every month.')
    expect(
      renewalNoteFor({
        preview: preview({ next_charge_at: null, recurring_cents: 94800, is_new_subscription: true }),
        period: 'annual',
      }),
    ).toBe('Then $948.00 every year.')
  })

  it('never renders an empty date', () => {
    for (const direction of ['upgrade', 'downgrade', 'unchanged'] as const) {
      for (const next_charge_at of [null, 'not-a-date']) {
        const note = renewalNoteFor({
          preview: preview({ direction, next_charge_at }),
          period: 'monthly',
        })
        expect(note, `${direction} ${next_charge_at}`).not.toContain(' on .')
        expect(note).not.toContain('  ')
      }
    }
  })
})

describe('cancelNoteFor', () => {
  // Ruling R11: misleading on an annual commitment.
  it('offers cancel anytime on monthly only', () => {
    expect(cancelNoteFor('monthly')).toBe('Cancel anytime.')
    expect(cancelNoteFor('annual')).toBeNull()
  })
})

describe('taxNoteFor', () => {
  // Ruling R8's honesty valve: the quote is short of the real charge, so say so.
  it('warns that tax is added at checkout when the quote excludes it', () => {
    expect(taxNoteFor(preview({ tax_excluded: true }))).toBe('Sales tax is calculated at checkout.')
  })
  it('stays silent when tax is already inside the quote', () => {
    expect(taxNoteFor(preview({ tax_excluded: false, tax_cents: 817 }))).toBeNull()
  })
})

describe('prorationNoteFor', () => {
  it('explains a part-period charge on an upgrade to a live subscription', () => {
    expect(prorationNoteFor(preview({ direction: 'upgrade', is_new_subscription: false }))).toBe(
      "Today's amount covers the rest of your current billing period.",
    )
  })
  it('says nothing on a first purchase, where the charge is a full period', () => {
    expect(prorationNoteFor(preview({ direction: 'upgrade', is_new_subscription: true }))).toBeNull()
  })
  it('says nothing on a downgrade or an unchanged plan', () => {
    expect(prorationNoteFor(preview({ direction: 'downgrade' }))).toBeNull()
    expect(prorationNoteFor(preview({ direction: 'unchanged' }))).toBeNull()
  })
})

describe('seat copy', () => {
  it('reports seats in use against seats included', () => {
    expect(seatHelperText(6, 8)).toBe('6 in use, 8 included at no extra cost')
  })
  it('explains why the stepper will not go lower', () => {
    expect(seatMinReasonFor('growth', 3)).toBe('Growth includes 8 seats.')
    expect(seatMinReasonFor('growth', 11)).toBe('You have 11 cleaners on your team.')
    expect(seatMinReasonFor('growth', 1)).toBe('Growth includes 8 seats.')
  })
})

describe('no em dash anywhere in this component model', () => {
  it('holds across every generated string', () => {
    const strings: string[] = []
    for (const period of ['monthly', 'annual'] as BillingPeriod[]) {
      strings.push(cancelNoteFor(period) ?? '')
      for (const seats of [0, 1, 6, 16, 40]) {
        for (const o of buildTierOptions({ period, seatsInUse: seats, currentTier: null })) {
          strings.push(o.name, o.unavailableReason ?? '', o.fitReason ?? '')
        }
        for (const tier of PLAN_TIERS) {
          const seatCount = clampSeats({ tier, seatsInUse: seats, desired: seats })
          const lines = planLines({ tier, period, seatCount })
          strings.push(lines.base.label, lines.seats.label)
          strings.push(seatHelperText(seats, PLANS[tier].includedSeats))
          strings.push(seatMinReasonFor(tier as PlanTier, seats))
        }
      }
      for (const direction of ['upgrade', 'downgrade', 'unchanged'] as const) {
        for (const next_charge_at of [null, '2026-10-21T00:00:00.000Z']) {
          const p = preview({ direction, next_charge_at })
          strings.push(totalRowFor(p).label)
          strings.push(renewalNoteFor({ preview: p, period }) ?? '')
          strings.push(taxNoteFor(p) ?? '', prorationNoteFor(p) ?? '')
        }
      }
    }
    for (const s of strings) expect(s).not.toContain(EM_DASH)
    expect(strings.length).toBeGreaterThan(100)
  })
})

// The renderer itself cannot be mounted in a test: this repo has no
// component-rendering setup and @testing-library/react is not a dependency, by
// standing decision. These static checks are the only guard that PlanPicker
// still DELEGATES the money rules to the model above rather than restating
// them inline, which is how a ruling gets quietly reverted. They are
// deliberately few and each maps to a specific ruling.
describe('PlanPicker delegates its money rules to this model', () => {
  const source = readFileSync(new URL('./PlanPicker.tsx', import.meta.url), 'utf8')

  // Asserting the CALL, not the identifier: an import line alone keeps the name
  // in the file long after the call site has been replaced by a literal.
  it('takes each default from the model at the point of use (rulings R4, R5)', () => {
    expect(source).toMatch(/initialPeriodFor\(currentPeriod\)/)
    expect(source).toMatch(/defaultTierFor\(seatsInUse, currentTier\)/)
    expect(source).toMatch(/initialSeatsFor\(\{/)
    expect(source).toMatch(/clampSeats\(\{/)
    expect(source).toMatch(/seatRangeFor\(tier, seatsInUse\)/)
  })

  it('reads the raw query result in exactly one place, the quote gate', () => {
    // More than one read means some figure is being drawn from data that has
    // not been checked against the selection on screen.
    expect(source.match(/previewQuery\.data/g) ?? []).toHaveLength(1)
    expect(source).toMatch(/quoteStateFor\(\{/)
    expect(source).toMatch(/const preview = quote\.preview/)
  })

  it('gates EVERY submit button on the quote, not only the first', () => {
    const submits = (source.match(/onClick=\{handleSubmit\}/g) ?? []).length
    const gated = (source.match(/disabled=\{!quote\.canSubmit\}/g) ?? []).length
    expect(submits).toBeGreaterThan(0)
    expect(gated).toBe(submits)
  })

  it('wires the stepper to the computed range, not to a literal', () => {
    expect(source).toMatch(/min=\{seatRange\.min\}/)
    expect(source).toMatch(/max=\{seatRange\.max\}/)
  })

  it('takes the total label from the preview direction, never a literal (ruling R21)', () => {
    expect(source).toContain('totalRowFor')
    for (const literal of ['Due today', 'Charged today', 'Credited to your next invoice']) {
      expect(source, literal).not.toContain(literal)
    }
  })

  it('never hardcodes a billing period, so ruling R4 cannot be reverted in the view', () => {
    expect(source).not.toMatch(/useState<BillingPeriod>\(\s*'annual'/)
    expect(source).not.toMatch(/useState\(\s*'annual'/)
  })

  it('carries no trust badge, seal, countdown or popularity claim (ruling R9)', () => {
    for (const banned of ['Most popular', 'Recommended', 'Best value', 'guarantee', 'Limited time']) {
      expect(source.toLowerCase(), banned).not.toContain(banned.toLowerCase())
    }
  })

  it('shows a skeleton rather than a stale or guessed total', () => {
    expect(source).toContain('Skeleton')
    expect(source).toContain('Could not price this change. Please try again.')
  })

  it('writes no raw hex colour and no em dash', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toContain(EM_DASH)
  })
})

describe('seatRangeFor', () => {
  it('hands the stepper the floor and the tier cap', () => {
    expect(seatRangeFor('growth', 3)).toEqual({ min: 8, max: 15 })
    expect(seatRangeFor('growth', 11)).toEqual({ min: 11, max: 15 })
    expect(seatRangeFor('pro', 2)).toEqual({ min: 15, max: null })
    expect(seatRangeFor('starter', 4)).toEqual({ min: 4, max: 5 })
  })
})

describe('quoteStateFor', () => {
  const quote = preview()
  const base = {
    seats: 10,
    pricedSeats: 10,
    isFetching: false,
    error: null,
    data: quote,
    submitting: false,
  }

  it('shows the quote and allows submit once the request has settled', () => {
    const state = quoteStateFor(base)
    expect(state.status).toBe('ready')
    expect(state.preview).toBe(quote)
    expect(state.canSubmit).toBe(true)
  })

  // The failure this whole component exists to prevent: the stepper says 12
  // seats, the last quote priced 10, and the old total sits next to the new
  // selection.
  it('hides a quote priced for a different seat count', () => {
    const state = quoteStateFor({ ...base, seats: 12 })
    expect(state.status).toBe('pending')
    expect(state.preview).toBeNull()
    expect(state.canSubmit).toBe(false)
  })

  it('hides the quote while a new request is in flight', () => {
    const state = quoteStateFor({ ...base, isFetching: true })
    expect(state.status).toBe('pending')
    expect(state.preview).toBeNull()
    expect(state.canSubmit).toBe(false)
  })

  it('refuses the purchase when pricing failed', () => {
    const state = quoteStateFor({ ...base, error: new Error('boom'), data: undefined })
    expect(state.status).toBe('error')
    expect(state.preview).toBeNull()
    expect(state.canSubmit).toBe(false)
  })

  it('refuses the purchase when pricing failed even if a stale quote is cached', () => {
    const state = quoteStateFor({ ...base, error: new Error('boom') })
    expect(state.status).toBe('error')
    expect(state.preview).toBeNull()
    expect(state.canSubmit).toBe(false)
  })

  it('waits rather than guessing when there is no quote at all', () => {
    const state = quoteStateFor({ ...base, data: undefined })
    expect(state.status).toBe('pending')
    expect(state.preview).toBeNull()
    expect(state.canSubmit).toBe(false)
  })

  it('blocks a second submit while the first is running', () => {
    expect(quoteStateFor({ ...base, submitting: true }).canSubmit).toBe(false)
  })

  it('never allows submit without a preview, under any combination', () => {
    for (const seats of [10, 12]) {
      for (const isFetching of [false, true]) {
        for (const error of [null, new Error('x')]) {
          for (const data of [quote, undefined]) {
            for (const submitting of [false, true]) {
              const state = quoteStateFor({ seats, pricedSeats: 10, isFetching, error, data, submitting })
              if (state.canSubmit) expect(state.preview).not.toBeNull()
              if (state.preview === null) expect(state.canSubmit).toBe(false)
            }
          }
        }
      }
    }
  })
})
