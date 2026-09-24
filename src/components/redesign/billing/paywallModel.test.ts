import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  asBillingPeriod,
  asPlanTier,
  cachedCount,
  paywallCopyFor,
  paywallGate,
  reassuranceLine,
  showsPlanPicker,
  type PaywallGateInput,
} from './paywallModel'
import type { BillingAccess, BillingState } from '@/lib/billing/access'

const EM_DASH = '—'

const ALL_STATES: BillingState[] = [
  'comped',
  'paused',
  'trialing',
  'trial_expired',
  'active',
  'past_due',
  'unpaid',
  'canceled',
]

/** The four states that have wall copy. Everything else must render the app. */
const WALL_STATES: BillingState[] = ['trial_expired', 'canceled', 'unpaid', 'paused']

function access(state: BillingState, frozen = true): BillingAccess {
  return { state, frozen, trialDaysLeft: null, canExtendTrial: false, seatCap: null }
}

function input(over: Partial<PaywallGateInput> = {}): PaywallGateInput {
  return {
    uiEnabled: true,
    access: access('trial_expired'),
    isOwner: true,
    isOpen: true,
    pauseResumesAt: null,
    ...over,
  }
}

describe('paywallCopyFor', () => {
  it('uses the locked copy for each state, verbatim', () => {
    expect(paywallCopyFor('trial_expired')).toEqual({
      headline: 'Your trial has ended',
      subhead: 'Your account is in view-only mode. Pick a plan to start booking again.',
    })
    expect(paywallCopyFor('canceled')).toEqual({
      headline: 'Your subscription has ended',
      subhead: 'Your account is in view-only mode. Choose a plan to start booking again.',
    })
    expect(paywallCopyFor('unpaid')).toEqual({
      headline: 'We could not process your payment',
      subhead:
        'Your account is in view-only mode. Update your payment method or choose a plan to continue.',
    })
  })

  it('gives each wall state a DISTINCT headline, so a copy mix-up is visible', () => {
    const headlines = WALL_STATES.map((s) => paywallCopyFor(s, { pauseResumesAt: null })!.headline)
    expect(new Set(headlines).size).toBe(WALL_STATES.length)
  })

  it('names the pause resume date when there is one', () => {
    expect(paywallCopyFor('paused', { pauseResumesAt: '2026-11-03T00:00:00.000Z' })).toEqual({
      headline: 'Your account is paused',
      subhead: 'Paused until November 3, 2026. Contact us if you need to resume early.',
    })
  })

  it('never renders an empty date, for a null or an unparseable value', () => {
    for (const bad of [null, '', 'not-a-date']) {
      const copy = paywallCopyFor('paused', { pauseResumesAt: bad })!
      expect(copy.subhead, String(bad)).toBe(
        'Your account is paused for now. Contact us if you need to resume early.',
      )
      expect(copy.subhead).not.toMatch(/until\s*\./)
    }
  })

  it('returns null for every state that has no wall copy', () => {
    for (const state of ALL_STATES.filter((s) => !WALL_STATES.includes(s))) {
      expect(paywallCopyFor(state), state).toBeNull()
    }
  })

  it('writes no em dash in any string it can produce', () => {
    for (const state of ALL_STATES) {
      const copy = paywallCopyFor(state, { pauseResumesAt: '2026-11-03T00:00:00.000Z' })
      if (!copy) continue
      expect(copy.headline, state).not.toContain(EM_DASH)
      expect(copy.subhead, state).not.toContain(EM_DASH)
    }
  })
})

describe('showsPlanPicker', () => {
  it('sells a plan on every wall state except paused (spec 13)', () => {
    expect(showsPlanPicker('paused')).toBe(false)
    for (const state of WALL_STATES.filter((s) => s !== 'paused')) {
      expect(showsPlanPicker(state), state).toBe(true)
    }
  })
})

describe('paywallGate', () => {
  it('shows the wall for a frozen owner with the flag on', () => {
    const gate = paywallGate(input())
    expect(gate.show).toBe(true)
    if (gate.show) {
      expect(gate.copy.headline).toBe('Your trial has ended')
      expect(gate.showPicker).toBe(true)
    }
  })

  it('shows no picker on a paused account', () => {
    const gate = paywallGate(input({ access: access('paused') }))
    expect(gate.show && gate.showPicker).toBe(false)
  })

  // Each of the next four is one deliberate mutation of the component's wiring.
  it('NEVER shows with the flag off, in any state (the ship-dark gate)', () => {
    for (const state of ALL_STATES) {
      expect(paywallGate(input({ uiEnabled: false, access: access(state) })).show, state).toBe(false)
    }
  })

  it('NEVER shows to a non-owner, in any state (ruling R2)', () => {
    for (const state of ALL_STATES) {
      expect(paywallGate(input({ isOwner: false, access: access(state) })).show, state).toBe(false)
    }
  })

  it('NEVER shows for an account that is not frozen, in any state', () => {
    for (const state of ALL_STATES) {
      expect(paywallGate(input({ access: access(state, false) })).show, state).toBe(false)
    }
  })

  // ⭐ The one that matters most. Dismissal outranks every other input there is.
  it('NEVER shows once dismissed, whatever billing says', () => {
    for (const state of ALL_STATES) {
      for (const frozen of [true, false]) {
        const gate = paywallGate(input({ isOpen: false, access: access(state, frozen) }))
        expect(gate.show, `${state}/${frozen}`).toBe(false)
      }
    }
  })

  it('shows nothing while billing state is still loading', () => {
    expect(paywallGate(input({ access: null })).show).toBe(false)
  })

  it('renders the dashboard rather than a wordless wall for a frozen state it has no copy for', () => {
    // Cannot happen today; `frozen` and `state` come from one derivation. If it
    // ever does, failing OPEN (the app) is the only safe direction.
    for (const state of ALL_STATES.filter((s) => !WALL_STATES.includes(s))) {
      expect(paywallGate(input({ access: access(state, true) })).show, state).toBe(false)
    }
  })

  // Exhaustive: the gate is an AND of five conditions plus copy, and nothing
  // else. A stuck `true` in any clause shows up here.
  it('shows the wall for exactly the combinations that satisfy every condition', () => {
    for (const uiEnabled of [true, false]) {
      for (const isOwner of [true, false]) {
        for (const isOpen of [true, false]) {
          for (const frozen of [true, false]) {
            for (const state of ALL_STATES) {
              const expected =
                uiEnabled && isOwner && isOpen && frozen && WALL_STATES.includes(state)
              const label = `${state} flag=${uiEnabled} owner=${isOwner} open=${isOpen} frozen=${frozen}`
              expect(paywallGate(input({ uiEnabled, isOwner, isOpen, access: access(state, frozen) })).show, label).toBe(expected)
            }
          }
        }
      }
    }
  })
})

describe('reassuranceLine', () => {
  it('names both counts when both are real', () => {
    expect(reassuranceLine({ jobs: 128, customers: 34 })).toBe(
      'Your 128 jobs, 34 customers and all cleaner payout history are exactly where you left them.',
    )
  })

  it('drops the counts when either is missing from the cache', () => {
    const generic =
      'Your jobs, customers and cleaner payout history are exactly where you left them.'
    expect(reassuranceLine({ jobs: null, customers: 34 })).toBe(generic)
    expect(reassuranceLine({ jobs: 128, customers: null })).toBe(generic)
    expect(reassuranceLine({ jobs: null, customers: null })).toBe(generic)
  })

  it('never says "Your 0 jobs"', () => {
    for (const counts of [
      { jobs: 0, customers: 4 },
      { jobs: 4, customers: 0 },
      { jobs: 0, customers: 0 },
    ]) {
      expect(reassuranceLine(counts), JSON.stringify(counts)).not.toMatch(/\b0\b/)
    }
  })

  it('writes no em dash', () => {
    expect(reassuranceLine({ jobs: 2, customers: 2 })).not.toContain(EM_DASH)
    expect(reassuranceLine({ jobs: null, customers: null })).not.toContain(EM_DASH)
  })
})

describe('cachedCount', () => {
  it('counts a loaded list', () => {
    expect(cachedCount([1, 2, 3])).toBe(3)
    expect(cachedCount([])).toBe(0)
  })
  it('refuses anything that is not a loaded list', () => {
    for (const value of [undefined, null, 7, 'nine', { length: 4 }, { pages: [] }]) {
      expect(cachedCount(value), JSON.stringify(value) ?? 'undefined').toBeNull()
    }
  })
})

describe('loose billing columns are narrowed before they reach the picker', () => {
  it('accepts only real tiers', () => {
    expect(asPlanTier('growth')).toBe('growth')
    expect(asPlanTier('starter')).toBe('starter')
    expect(asPlanTier('pro')).toBe('pro')
    for (const bad of [null, undefined, '', 'enterprise', 'Growth', 3]) {
      expect(asPlanTier(bad), String(bad)).toBeNull()
    }
  })
  it('accepts only real periods', () => {
    expect(asBillingPeriod('monthly')).toBe('monthly')
    expect(asBillingPeriod('annual')).toBe('annual')
    for (const bad of [null, undefined, 'yearly', 'month', 1]) {
      expect(asBillingPeriod(bad), String(bad)).toBeNull()
    }
  })
})

// The renderer cannot be mounted: this repo has no component-rendering setup
// and @testing-library/react is not a dependency, by standing decision (see
// planPickerModel.test.ts). These static checks are the only guard that the
// wall is still WIRED the way the model above assumes. Each maps to a specific
// mutation that would otherwise ship silently.
/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('BillingPaywall wiring', () => {
  const source = readFileSync(new URL('./BillingPaywall.tsx', import.meta.url), 'utf8')

  it('decides visibility in the gate, once, and honours the answer', () => {
    expect(source).toMatch(/paywallGate\(\{/)
    expect(source).toMatch(/if \(!gate\.show\) return <>\{children\}<\/>/)
    // No second, inline copy of the gate's conditions.
    expect(source).not.toMatch(/access\??\.frozen\s*&&/)
    expect(source).not.toMatch(/isOwner\s*&&\s*</)
  })

  it('feeds the gate every input from the hook, including the flag', () => {
    const call = source.match(/paywallGate\(\{([\s\S]*?)\}\)/)![1]
    for (const field of ['uiEnabled', 'access', 'isOwner', 'isOpen', 'pauseResumesAt']) {
      expect(call, field).toContain(field)
    }
    // The values themselves come from useBilling, not from a literal.
    expect(source).toMatch(/const \{ access, billing, seatsInUse, isOwner, uiEnabled \} = useBilling\(\)/)
    expect(call).not.toMatch(/(uiEnabled|isOwner|isOpen):\s*(true|false)/)
  })

  it('re-opens only through the edge-triggered sync, never directly', () => {
    expect(source).toMatch(/syncPaywallFrozen\(frozen\)/)
    // A direct openPaywall() in a render or an effect is the Asana trap. Read
    // past the comments: the file explains the rule in prose too.
    expect(code(source)).not.toContain('openPaywall(')
  })

  // ⚠ The escape hatch. Everything in this block is load bearing.
  const hatch = source.match(/const escapeHatch = \(\n([\s\S]*?)\n {2}\)\n/)

  it('declares the escape hatch unconditionally', () => {
    expect(hatch, 'escapeHatch declaration not found').not.toBeNull()
    const block = hatch![1]
    expect(block).toContain('variant="outline"')
    expect(block).toContain('View your data')
    expect(block).toContain('onClick={close}')
    // No condition, no disabled state, no hiding. Any of these reproduces Asana.
    for (const forbidden of ['?', '&&', 'disabled', 'hidden', 'loading']) {
      expect(block, forbidden).not.toContain(forbidden)
    }
  })

  it('renders the escape hatch in BOTH branches, picker and paused', () => {
    const uses = source.match(/\{escapeHatch\}/g) ?? []
    expect(uses.length).toBe(2)
    const branch = source.match(/gate\.showPicker \? \(([\s\S]*?)\n\s*\)\}/)
    expect(branch, 'showPicker branch not found').not.toBeNull()
    const [picker, paused] = branch![1].split(') : (')
    expect(picker).toContain('{escapeHatch}')
    expect(paused).toContain('{escapeHatch}')
  })

  it('never puts the escape hatch behind a condition at its use sites', () => {
    expect(source).not.toMatch(/\?[^\n]*escapeHatch/)
    expect(source).not.toMatch(/escapeHatch[^\n]*&&/)
    expect(source).not.toMatch(/&&[^\n]*escapeHatch/)
  })

  it('takes close from the store, not from a prop or a local', () => {
    expect(source).toMatch(/const \{ isOpen, close \} = usePaywall\(\)/)
  })

  it('keeps the trial extension secondary (ruling R12)', () => {
    const extend = source.match(/const extendLink =([\s\S]*?)\n {2}\) : null/)![1]
    expect(extend).toContain('variant="link"')
    expect(extend).toContain('Extend your trial by seven days')
    expect(extend).toContain('access?.canExtendTrial')
  })

  // Touch-target rule: a variant="link" control keeps link styling and is not
  // held to the 44px button minimum, but a standalone tappable row (this link
  // is the only thing in its row) still needs a comfortable hit area rather
  // than the 36px size="sm" gives it on its own.
  it('gives the standalone Extend link a comfortable tap target', () => {
    const extend = source.match(/const extendLink =([\s\S]*?)\n {2}\) : null/)![1]
    expect(extend).toMatch(/min-h-\[44px\]/)
  })

  it('renders the picker once, only on the picker branch (paused sells nothing)', () => {
    expect((source.match(/<PlanPicker/g) ?? []).length).toBe(1)
    expect(source).toMatch(/gate\.showPicker \? \(\s*\n\s*<PlanPicker/)
  })

  // Both handlers are read separately: a single file-wide "is invalidateQueries
  // present" check passes while one of the two has lost it.
  function bodyOf(name: string): string {
    const match = source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n {2}\\}`))
    expect(match, `${name} not found`).not.toBeNull()
    return match![0]
  }

  it('sends the customer to hosted Checkout when the apply returns one (ruling R10)', () => {
    const body = bodyOf('handleSubmit')
    expect(body).toContain('window.location.href = result.checkout_url')
    // ...and returns, so a redirect never also falls through to close().
    expect(body).toMatch(/window\.location\.href = result\.checkout_url\s*\n\s*return/)
  })

  it('refreshes billing state and dismisses itself after an in-place plan change', () => {
    const body = bodyOf('handleSubmit')
    expect(body).toMatch(/invalidateQueries\(\{ queryKey: keys\.billing\.all \}\)/)
    expect(body).toContain('close()')
  })

  it('refreshes billing state after a trial extension, so the wall lifts itself', () => {
    expect(bodyOf('handleExtend')).toMatch(/invalidateQueries\(\{ queryKey: keys\.billing\.all \}\)/)
  })

  it('adds no query of its own for the reassurance counts', () => {
    expect(source).not.toContain('useQuery(')
    expect(source).toContain('queryClient.getQueryData')
  })

  it('writes no raw hex colour and no em dash', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toContain(EM_DASH)
  })
})

describe('OperatorShell mount', () => {
  const source = readFileSync(
    new URL('../shell/OperatorShell.tsx', import.meta.url),
    'utf8',
  )

  it('wraps the content, and wraps it exactly once', () => {
    expect(source).toContain('<BillingPaywall>{children}</BillingPaywall>')
    // Exactly one live use: an un-wrapped {children} anywhere else would render
    // the dashboard around the wall.
    expect((code(source).match(/\{children\}/g) ?? []).length).toBe(1)
  })

  it('leaves <main> and its classes untouched, so the wall sits INSIDE the shell', () => {
    expect(source).toContain(
      '<main id="main-content" className="mx-auto w-full max-w-[1700px] px-4 pb-28 pt-5 lg:px-6 lg:pb-10">',
    )
  })

  it('mounts no provider: the store is module level (Task 12 needs it without React)', () => {
    expect(source).not.toContain('PaywallProvider')
  })
})
