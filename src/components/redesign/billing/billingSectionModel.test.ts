// Every test below maps to a specific way Settings > Plan and billing can fail
// silently: an admin handed a live money control, a cancelling subscription
// still advertising a renewal date, past_due rendering as plain `active`, a
// paused or comped org being sold something, the flag-off line disappearing.
// Each has a dedicated test that fails if the bug is reintroduced.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  actionStateFor,
  billingSectionView,
  BADGE_VARIANT_FOR_TONE,
  BILLING_DISABLED_MESSAGE,
  BILLING_UNAVAILABLE_MESSAGE,
  OWNER_ONLY_REASON,
  PAST_DUE_NOTICE,
  type BillingSectionInput,
  type BillingSectionSpec,
} from './billingSectionModel'
import { formatBillingDate } from '@/lib/billing/format'
import {
  deriveBillingAccess,
  type BillingAccess,
  type BillingState,
  type OrgBillingRow,
} from '@/lib/billing/access'

const EM_DASH = '—'

const ALL_STATES: BillingState[] = [
  'comped', 'paused', 'trialing', 'trial_expired', 'active', 'past_due', 'unpaid', 'canceled',
]

const PERIOD_END = '2026-10-21T12:00:00.000Z'
const CANCEL_AT = '2026-11-03T12:00:00.000Z'

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

function input(over: Partial<BillingSectionInput> = {}): BillingSectionInput {
  return {
    uiEnabled: true,
    isLoading: false,
    access: access(),
    seatsInUse: 6,
    tier: 'growth',
    period: 'monthly',
    seatCount: 8,
    currentPeriodEnd: PERIOD_END,
    cancelAt: null,
    pauseResumesAt: null,
    ...over,
  }
}

function specFor(over: Partial<BillingSectionInput> = {}): BillingSectionSpec {
  const view = billingSectionView(input(over))
  if (view.kind !== 'plan') throw new Error(`expected a plan view, got ${view.kind}`)
  return view.spec
}

const lines = (spec: BillingSectionSpec) => spec.card.lines.map((l) => l.text)
const kinds = (spec: BillingSectionSpec) => spec.actions.map((a) => a.kind)

/** The access shape deriveBillingAccess really produces for each state. */
const ACCESS_FOR: Record<BillingState, BillingAccess> = {
  comped: access({ state: 'comped', seatCap: null }),
  paused: access({ state: 'paused', frozen: true }),
  trialing: access({ state: 'trialing', trialDaysLeft: 9, canExtendTrial: true, seatCap: 15 }),
  trial_expired: access({ state: 'trial_expired', frozen: true, trialDaysLeft: 0, canExtendTrial: true, seatCap: 15 }),
  active: access({ state: 'active' }),
  past_due: access({ state: 'past_due' }),
  unpaid: access({ state: 'unpaid', frozen: true }),
  canceled: access({ state: 'canceled', frozen: true }),
}

// ---------------------------------------------------------------------------
// The gates in front of the eight branches
// ---------------------------------------------------------------------------

describe('billingSectionView: gates', () => {
  // Mutation target: "render the plan card anyway when the flag is off".
  it('renders one line and NOTHING else while the UI flag is off, whatever the org state', () => {
    for (const state of ALL_STATES) {
      const view = billingSectionView(input({ uiEnabled: false, access: ACCESS_FOR[state] }))
      expect(view, state).toEqual({ kind: 'disabled', message: BILLING_DISABLED_MESSAGE })
    }
  })

  it('says exactly "Billing is not enabled for this account yet."', () => {
    expect(BILLING_DISABLED_MESSAGE).toBe('Billing is not enabled for this account yet.')
  })

  it('shows a loading view while the read is in flight, never an empty card', () => {
    expect(billingSectionView(input({ isLoading: true }))).toEqual({ kind: 'loading' })
  })

  // Mutation target: "assume access is non-null and read access.state".
  it('never throws and never renders an empty card when access is null (a 403, or no org)', () => {
    const view = billingSectionView(input({ access: null }))
    expect(view).toEqual({ kind: 'unavailable', message: BILLING_UNAVAILABLE_MESSAGE })
  })

  it('puts the flag ahead of loading and of a null read', () => {
    expect(billingSectionView(input({ uiEnabled: false, isLoading: true, access: null }))).toEqual({
      kind: 'disabled',
      message: BILLING_DISABLED_MESSAGE,
    })
  })
})

// ---------------------------------------------------------------------------
// trialing / trial_expired
// ---------------------------------------------------------------------------

describe('billingSectionView: trialing', () => {
  const trialing = { access: ACCESS_FOR.trialing, tier: null, period: null, seatCount: null }

  it('counts the days left and the trial seats, and offers a plan', () => {
    const spec = specFor(trialing)
    expect(spec.card.headline).toBe('9 days left in your trial')
    expect(lines(spec)).toEqual(['6 of 15 trial seats in use'])
    expect(kinds(spec)).toEqual(['choose-plan', 'extend'])
    expect(spec.pickerSubmitLabel).toBe('Continue to payment')
  })

  // Mutation target: "skip the singular".
  it('reads "1 day left in your trial", singular', () => {
    const spec = specFor({ ...trialing, access: access({ ...ACCESS_FOR.trialing, trialDaysLeft: 1 }) })
    expect(spec.card.headline).toBe('1 day left in your trial')
    expect(spec.card.headline).not.toBe('1 days left in your trial')
  })

  // Mutation target: "offer the extension to an org that already used it".
  it('drops the extension once it has been used', () => {
    const spec = specFor({
      ...trialing,
      access: access({ ...ACCESS_FOR.trialing, canExtendTrial: false }),
    })
    expect(kinds(spec)).toEqual(['choose-plan'])
  })

  it('keeps the extension secondary (a link), never the primary CTA (ruling R12)', () => {
    const extend = specFor(trialing).actions.find((a) => a.kind === 'extend')!
    expect(extend.variant).toBe('link')
    expect(specFor(trialing).actions[0].kind).toBe('choose-plan')
    expect(specFor(trialing).actions[0].variant).toBe('default')
  })

  it('shows no portal link on a trial: there is no invoice to read yet', () => {
    expect(kinds(specFor(trialing))).not.toContain('portal')
  })
})

describe('billingSectionView: trial_expired', () => {
  const expired = { access: ACCESS_FOR.trial_expired, tier: null, period: null, seatCount: null }

  // Mutation target: "render trial_expired as trialing" (which would say
  // "0 days left in your trial" in a neutral tone).
  it('is definite, not alarming: its own heading, caution tone, same controls', () => {
    const spec = specFor(expired)
    expect(spec.card.headline).toBe('Your trial has ended')
    expect(spec.card.tone).toBe('caution')
    expect(spec.card.badgeLabel).toBe('Trial ended')
    expect(kinds(spec)).toEqual(['choose-plan', 'extend'])
    expect(spec.notice).toBeNull()
  })

  it('never claims days are left once the trial has ended', () => {
    expect(specFor(expired).card.headline).not.toMatch(/days? left/)
  })
})

// ---------------------------------------------------------------------------
// active
// ---------------------------------------------------------------------------

describe('billingSectionView: active', () => {
  it('prices the plan per period, counts the org seat_count, and dates the renewal', () => {
    const spec = specFor()
    expect(spec.card.badgeLabel).toBe('Growth')
    expect(spec.card.headline).toBe('$99.00 per month')
    expect(lines(spec)).toEqual(['6 of 8 seats in use', `Renews on ${formatBillingDate(PERIOD_END)}`])
    expect(kinds(spec)).toEqual(['change-plan', 'portal'])
    expect(spec.pickerSubmitLabel).toBe('Update plan')
    expect(spec.notice).toBeNull()
  })

  // Mutation target: "charge the monthly figure on an annual plan" (an annual
  // Growth subscription is billed $948.00 a year, not $79.00).
  it('shows the ANNUAL charge, not the monthly-equivalent, on a yearly plan', () => {
    const spec = specFor({ period: 'annual', access: access({ state: 'active', seatCap: 8 }) })
    expect(spec.card.headline).toBe('$948.00 per year')
  })

  it('prices the paid-for seats, not the included ones', () => {
    // Growth includes 8; 10 seats is 8 + 2 x $10.
    const spec = specFor({ seatCount: 10, access: access({ seatCap: 10 }) })
    expect(spec.card.headline).toBe('$119.00 per month')
    expect(lines(spec)).toContain('6 of 10 seats in use')
  })

  // Mutation target: "drop the cancels-on override" (the single most expensive
  // wrong line on this screen: a customer who cancelled still being told the
  // subscription renews).
  it('REPLACES the renewal line with a cancellation line, never shows both', () => {
    const spec = specFor({ cancelAt: CANCEL_AT })
    expect(lines(spec)).toEqual(['6 of 8 seats in use', `Cancels on ${formatBillingDate(CANCEL_AT)}`])
    expect(lines(spec).join(' ')).not.toContain('Renews on')
    expect(spec.card.lines.at(-1)!.tone).toBe('caution')
  })

  it('drops the renewal line entirely rather than printing "Renews on ." for a missing date', () => {
    expect(lines(specFor({ currentPeriodEnd: null }))).toEqual(['6 of 8 seats in use'])
    expect(lines(specFor({ currentPeriodEnd: 'not-a-date' }))).toEqual(['6 of 8 seats in use'])
  })

  it('states what is true, and quotes no price, when the row carries no tier', () => {
    const spec = specFor({ tier: null })
    expect(spec.card.headline).toBe('Your plan is active')
    expect(spec.card.headline).not.toMatch(/\$/)
  })
})

// ---------------------------------------------------------------------------
// past_due
// ---------------------------------------------------------------------------

describe('billingSectionView: past_due', () => {
  const pastDue = { access: ACCESS_FOR.past_due }

  // Mutation target: "render past_due as active", which would leave a customer
  // whose card failed with no notice and Change plan as the primary action.
  it('adds a critical notice and makes fixing the card the primary action', () => {
    const spec = specFor(pastDue)
    expect(spec.notice).toEqual({ tone: 'critical', message: PAST_DUE_NOTICE })
    expect(spec.notice!.message).toBe('We could not process your last payment.')
    expect(kinds(spec)).toEqual(['update-payment', 'change-plan'])
    expect(spec.actions[0].variant).toBe('default')
  })

  // Mutation target: "leave Change plan primary".
  it('DEMOTES Change plan to secondary', () => {
    const changePlan = specFor(pastDue).actions.find((a) => a.kind === 'change-plan')!
    expect(changePlan.variant).toBe('outline')
  })

  it('still shows everything active shows: price, seats, renewal date', () => {
    const activeSpec = specFor()
    const spec = specFor(pastDue)
    expect(spec.card.headline).toBe(activeSpec.card.headline)
    expect(lines(spec)).toEqual(lines(activeSpec))
    expect(spec.pickerSubmitLabel).toBe('Update plan')
  })

  it('is visibly not the active branch: critical tone', () => {
    expect(specFor(pastDue).card.tone).toBe('critical')
    expect(specFor().card.tone).toBe('neutral')
  })
})

// ---------------------------------------------------------------------------
// unpaid (ruling R22: defensive only) and canceled
// ---------------------------------------------------------------------------

describe('billingSectionView: unpaid', () => {
  it('sends the owner to the portal and offers no plan picker: the card needs fixing, not a new plan', () => {
    const spec = specFor({ access: ACCESS_FOR.unpaid })
    expect(kinds(spec)).toEqual(['reactivate'])
    expect(spec.pickerSubmitLabel).toBeNull()
    expect(spec.card.tone).toBe('critical')
    expect(spec.notice!.tone).toBe('critical')
  })
})

describe('billingSectionView: canceled', () => {
  it('lets them buy again and still reach their invoices', () => {
    const spec = specFor({ access: ACCESS_FOR.canceled })
    expect(spec.card.headline).toBe('Your subscription has ended')
    expect(kinds(spec)).toEqual(['choose-plan', 'portal'])
    // No live subscription, so /api/billing/plan returns a Checkout URL.
    expect(spec.pickerSubmitLabel).toBe('Continue to payment')
  })
})

// ---------------------------------------------------------------------------
// paused and comped: the two states with NO controls at all
// ---------------------------------------------------------------------------

describe('billingSectionView: paused', () => {
  it('explains the pause, names the resume date, and offers NOTHING to click', () => {
    const spec = specFor({ access: ACCESS_FOR.paused, pauseResumesAt: CANCEL_AT })
    expect(spec.card.headline).toBe(`Your account is paused until ${formatBillingDate(CANCEL_AT)}.`)
    expect(lines(spec)).toEqual(['Contact us to resume early.'])
    expect(spec.actions).toEqual([])
    expect(spec.pickerSubmitLabel).toBeNull()
  })

  it('drops the date from the sentence rather than printing "paused until ."', () => {
    const spec = specFor({ access: ACCESS_FOR.paused, pauseResumesAt: null })
    expect(spec.card.headline).toBe('Your account is paused.')
    expect(spec.card.headline).not.toContain('until')
  })
})

describe('billingSectionView: comped', () => {
  it('names the comp, counts the seats, implies NO cap, and offers NOTHING to click', () => {
    const spec = specFor({ access: ACCESS_FOR.comped })
    expect(spec.card.headline).toBe('Complimentary plan')
    expect(lines(spec)).toEqual(['6 seats in use'])
    expect(lines(spec).join(' ')).not.toContain(' of ')
    expect(spec.actions).toEqual([])
    expect(spec.pickerSubmitLabel).toBeNull()
  })

  it('reads "1 seat in use", singular', () => {
    expect(lines(specFor({ access: ACCESS_FOR.comped, seatsInUse: 1 }))).toEqual(['1 seat in use'])
  })
})

// Mutation target: "show controls for comped or paused". Stated once more as
// an explicit pair, because these are the two states where a control is not
// merely wrong but actively misleading.
describe('the two no-control states', () => {
  it('NEVER produces an action or a picker for paused or comped, in any role or org shape', () => {
    for (const state of ['paused', 'comped'] as const) {
      for (const seatsInUse of [0, 1, 40]) {
        for (const tier of [null, 'pro'] as const) {
          const spec = specFor({ access: ACCESS_FOR[state], seatsInUse, tier })
          expect(spec.actions, `${state}/${seatsInUse}/${tier}`).toEqual([])
          expect(spec.pickerSubmitLabel, `${state}/${seatsInUse}/${tier}`).toBeNull()
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Role gating (ruling R15 v3): the admin must see the control, disabled, with
// a reason. Never a live control, never a hidden one.
// ---------------------------------------------------------------------------

describe('actionStateFor', () => {
  // Mutation target: "give an admin a live Change plan button".
  it('disables EVERY money control for a non-owner, with the reason, across all eight states', () => {
    const moneyKinds = ['choose-plan', 'change-plan', 'extend', 'reactivate']
    let seen = 0
    for (const state of ALL_STATES) {
      for (const action of specFor({ access: ACCESS_FOR[state] }).actions) {
        const asAdmin = actionStateFor(action, false)
        if (moneyKinds.includes(action.kind)) {
          seen += 1
          expect(action.ownerOnly, `${state}/${action.kind}`).toBe(true)
          expect(asAdmin, `${state}/${action.kind}`).toEqual({
            disabled: true,
            reason: OWNER_ONLY_REASON,
          })
        }
        // The owner is never blocked, in any state.
        expect(actionStateFor(action, true), `${state}/${action.kind}`).toEqual({
          disabled: false,
          reason: null,
        })
      }
    }
    // Guards the loop itself: if the branches stopped producing money controls
    // the assertions above would vacuously pass.
    expect(seen).toBeGreaterThanOrEqual(5)
  })

  it('leaves the portal enabled for an admin: that route really does allow them', () => {
    for (const state of ALL_STATES) {
      for (const action of specFor({ access: ACCESS_FOR[state] }).actions) {
        if (action.kind === 'portal' || action.kind === 'update-payment') {
          expect(actionStateFor(action, false), `${state}/${action.kind}`).toEqual({
            disabled: false,
            reason: null,
          })
        }
      }
    }
  })

  it('says exactly "Only the account owner can change the plan."', () => {
    expect(OWNER_ONLY_REASON).toBe('Only the account owner can change the plan.')
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting invariants over every reachable billing row
// ---------------------------------------------------------------------------

describe('every state, and every row deriveBillingAccess can produce', () => {
  const NOW = new Date('2026-09-22T00:00:00.000Z')

  function row(over: Partial<OrgBillingRow>): OrgBillingRow {
    return {
      subscription_status: 'trialing',
      trial_ends_at: null,
      trial_extended_at: null,
      comped_at: null,
      plan_tier: 'growth',
      billing_period: 'monthly',
      seat_count: 8,
      subscription_cancel_at: null,
      billing_paused_at: null,
      billing_pause_resumes_at: null,
      ...over,
    }
  }

  const ROWS: OrgBillingRow[] = [
    row({ comped_at: '2026-01-01T00:00:00.000Z' }),
    row({ billing_paused_at: '2026-09-01T00:00:00.000Z', billing_pause_resumes_at: '2026-10-01T00:00:00.000Z' }),
    row({ subscription_status: 'trialing', trial_ends_at: '2026-10-06T00:00:00.000Z' }),
    row({ subscription_status: 'trialing', trial_ends_at: '2026-09-22T12:00:00.000Z' }),
    row({ subscription_status: 'trialing', trial_ends_at: '2026-09-01T00:00:00.000Z' }),
    row({ subscription_status: 'active' }),
    row({ subscription_status: 'active', subscription_cancel_at: '2026-11-03T00:00:00.000Z' }),
    row({ subscription_status: 'past_due' }),
    row({ subscription_status: 'unpaid' }),
    row({ subscription_status: 'canceled' }),
    row({ subscription_status: 'none' }),
  ]

  it('produces a complete, non-empty card for every row, with no em dash anywhere', () => {
    for (const r of ROWS) {
      const derived = deriveBillingAccess(r, NOW)
      const view = billingSectionView(
        input({
          access: derived,
          tier: 'growth',
          period: 'monthly',
          seatCount: r.seat_count,
          cancelAt: r.subscription_cancel_at,
          pauseResumesAt: r.billing_pause_resumes_at,
        }),
      )
      expect(view.kind, String(r.subscription_status)).toBe('plan')
      if (view.kind !== 'plan') continue
      const { spec } = view
      const text = [
        spec.lead,
        spec.card.badgeLabel,
        spec.card.headline,
        ...lines(spec),
        spec.notice?.message ?? '',
        ...spec.actions.map((a) => a.label),
        spec.pickerSubmitLabel ?? '',
      ].join(' ')
      expect(spec.card.headline.length, String(r.subscription_status)).toBeGreaterThan(0)
      expect(spec.card.badgeLabel.length, String(r.subscription_status)).toBeGreaterThan(0)
      expect(text, String(r.subscription_status)).not.toContain(EM_DASH)
      // No unresolved template or dangling date fragment ever reaches a user.
      expect(text, String(r.subscription_status)).not.toMatch(/\{|\}|\son\s\./)
    }
  })

  it('never offers a picker label without an action that opens it, and never the reverse', () => {
    for (const state of ALL_STATES) {
      const spec = specFor({ access: ACCESS_FOR[state] })
      const opens = spec.actions.some((a) => a.kind === 'choose-plan' || a.kind === 'change-plan')
      expect(Boolean(spec.pickerSubmitLabel), state).toBe(opens)
    }
  })

  it('gives every action a distinct kind, so nothing renders twice', () => {
    for (const state of ALL_STATES) {
      const k = kinds(specFor({ access: ACCESS_FOR[state] }))
      expect(new Set(k).size, state).toBe(k.length)
    }
  })

  it('maps every card tone to a badge variant that exists', () => {
    for (const state of ALL_STATES) {
      const spec = specFor({ access: ACCESS_FOR[state] })
      expect(BADGE_VARIANT_FOR_TONE[spec.card.tone], state).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// Wiring: BillingSection.tsx cannot be mounted (no component-rendering setup,
// no @testing-library/react by standing decision). These static checks are the
// only guard that the renderer honours the model above. Each maps to a
// specific mutation that would otherwise ship silently.
// ---------------------------------------------------------------------------

/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('BillingSection wiring', () => {
  const source = readFileSync(
    new URL('../settings/sections/BillingSection.tsx', import.meta.url),
    'utf8',
  )
  const clean = code(source)

  it('decides every branch in billingSectionView, once, and hand-rolls none of it', () => {
    expect(clean).toMatch(/billingSectionView\(\{/)
    expect((clean.match(/billingSectionView\(/g) ?? []).length).toBe(1)
    expect(clean).not.toMatch(/access[?.]*\.state\s*===/)
    expect(clean).not.toMatch(/access[?.]*\.frozen/)
  })

  it('feeds the model every input, none of them hardcoded', () => {
    const call = clean.match(/billingSectionView\(\{([\s\S]*?)\n\s*\}\)/)![1]
    for (const field of [
      'uiEnabled', 'isLoading', 'access', 'seatsInUse', 'tier', 'period',
      'seatCount', 'currentPeriodEnd', 'cancelAt', 'pauseResumesAt',
    ]) {
      expect(call, field).toContain(field)
    }
    expect(call).not.toMatch(/(uiEnabled|isLoading):\s*(true|false)/)
  })

  // Mutation target: "read currentPeriodEnd off the billing row". It is a
  // SIBLING of `billing` on useBilling, not a column, so that silently yields
  // undefined and the renewal line vanishes.
  it('reads currentPeriodEnd from the hook, not from billing.*', () => {
    expect(clean).not.toMatch(/billing[?.]*\.current_period_end/)
    expect(clean).toMatch(/currentPeriodEnd/)
  })

  // Mutation target: "hide the control from an admin instead of disabling it".
  it('NEVER hides an action by role: no isOwner conditional around the buttons', () => {
    expect(clean).not.toMatch(/isOwner\s*&&/)
    expect(clean).not.toMatch(/isOwner\s*\?/)
    expect(clean).not.toMatch(/if\s*\(\s*!?\s*isOwner\s*\)/)
  })

  // Mutation target: "drop the tooltip" or "drop the disabled attribute",
  // either of which leaves an admin with a control and no explanation.
  it('disables through actionStateFor and explains with a Tooltip', () => {
    expect(clean).toContain('actionStateFor(')
    expect(clean).toMatch(/disabled=\{state\.disabled\}/)
    expect(clean).toContain('<TooltipTrigger')
    expect(clean).toMatch(/<TooltipContent>\{state\.reason\}<\/TooltipContent>/)
  })

  // Mutation target: "put the button straight in the trigger". A disabled
  // button fires no pointer events, so the reason becomes unreachable.
  it('wraps the disabled button in a focusable span so the reason is reachable', () => {
    const trigger = clean.match(/<TooltipTrigger asChild>([\s\S]*?)<\/TooltipTrigger>/)![1]
    expect(trigger).toMatch(/<span[^>]*tabIndex=\{0\}/)
  })

  // Mutation target: "return null for a control the role cannot use", the same
  // hiding failure by another route, which the isOwner guards above would miss.
  it('ActionButton always renders a button: it has no way to render nothing', () => {
    const body = clean.slice(clean.indexOf('function ActionButton('))
    expect(body.length, 'ActionButton not found').toBeGreaterThan(0)
    expect(body).not.toMatch(/return null/)
    expect(body).not.toMatch(/return\s*<>\s*<\/>/)
  })

  it('mounts its own TooltipProvider, so the reason works wherever the section renders', () => {
    expect(clean).toContain('<TooltipProvider')
  })

  // Mutation target: "pass the raw isLoading". useOrgQuery is disabled until the
  // org id lands, which reports isLoading false with no data, so the section
  // would flash the could-not-load line on every cold open.
  it('counts the org-bootstrap window as loading, not as a failed read', () => {
    expect(clean).toMatch(/isLoading: isLoading \|\| !orgId/)
  })

  it('renders the flag-off line and never an empty card', () => {
    expect(clean).toMatch(/view\.kind === ['"]disabled['"]/)
    expect(clean).toMatch(/view\.kind === ['"]unavailable['"]/)
    expect(clean).toMatch(/view\.kind === ['"]loading['"]/)
    expect(clean).toContain('{view.message}')
  })

  it('opens the SAME PlanPicker rather than rebuilding a pricing table (ruling R3)', () => {
    expect(clean).toContain('<PlanPicker')
    expect(clean).toMatch(/submitLabel=\{spec\.pickerSubmitLabel\}/)
    // The picker is behind an action, not always on screen.
    expect(clean).toMatch(/picking && spec\.pickerSubmitLabel/)
    expect(clean).not.toContain('PLANS[')
  })

  it('routes the portal through getPortalUrl and the plan change through changePlan', () => {
    expect(clean).toContain('getPortalUrl(')
    expect(clean).toContain('changePlan(')
    expect(clean).not.toMatch(/fetch\(/)
  })

  // Money is integer cents; the formatting boundary for this screen is the
  // model, which is under test. A component that formats its own money is a
  // second, untested boundary.
  it('formats no money and no dates of its own', () => {
    expect(clean).not.toContain('formatCents(')
    expect(clean).not.toContain('formatBillingDate(')
    expect(clean).not.toContain('planChargeCents(')
  })

  it('leaves the Task 11 checkout-return seam marked, and does not build it', () => {
    expect(source).toContain('checkout=success')
    expect(clean).not.toContain('checkout=success')
  })

  it('writes no raw hex colour and no em dash', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toContain(EM_DASH)
  })
})

describe('settings registration', () => {
  const sectionsSource = readFileSync(new URL('../settings/sections.ts', import.meta.url), 'utf8')
  const registrySource = readFileSync(
    new URL('../settings/sections/registry.ts', import.meta.url),
    'utf8',
  )

  it('registers billing for owner and admin, directly after payments', () => {
    const clean = code(sectionsSource)
    expect(clean).toMatch(
      /id: "billing", label: "Plan and billing", icon: \w+, group: "business", roles: \["owner", "admin"\]/,
    )
    expect(clean.indexOf('id: "payments"')).toBeLessThan(clean.indexOf('id: "billing"'))
    expect(clean.indexOf('id: "billing"')).toBeLessThan(clean.indexOf('id: "cancellation"'))
  })

  // Mutation target: "add it to the union but never to the registry", which
  // renders an undefined component at ?section=billing.
  it('wires the component into the registry', () => {
    expect(registrySource).toContain('import { BillingSection } from "./BillingSection"')
    expect(registrySource).toMatch(/billing: BillingSection,/)
  })
})
