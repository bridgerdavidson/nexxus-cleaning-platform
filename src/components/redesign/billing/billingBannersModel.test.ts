// Every test below maps to a specific way this ladder can fail silently:
// a manager seeing the pill, a frozen bar the user can dismiss, a non-owner
// getting a live CTA, all three severities collapsing to one tone, or the
// day-1 message losing its singular. Each has a dedicated test that would
// fail if the corresponding bug were reintroduced.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  billingBanner,
  trialPillState,
  type BillingBannerInput,
  type TrialPillInput,
} from './billingBannersModel'
import { deriveBillingAccess, type BillingAccess, type BillingState, type OrgBillingRow } from '@/lib/billing/access'

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

const FROZEN_STATES: BillingState[] = ['paused', 'trial_expired', 'unpaid', 'canceled']

function access(over: Partial<BillingAccess> = {}): BillingAccess {
  return { state: 'trialing', frozen: false, trialDaysLeft: 7, canExtendTrial: false, seatCap: null, ...over }
}

function pillInput(over: Partial<TrialPillInput> = {}): TrialPillInput {
  return {
    uiEnabled: true,
    canSeeBillingChrome: true,
    access: access({ state: 'trialing', trialDaysLeft: 7 }),
    dismissed: false,
    ...over,
  }
}

function bannerInput(over: Partial<BillingBannerInput> = {}): BillingBannerInput {
  return {
    uiEnabled: true,
    access: access({ state: 'trial_expired', frozen: true, trialDaysLeft: 0, canExtendTrial: true }),
    isOwner: true,
    canSeeBillingChrome: true,
    pauseResumesAt: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// trialPillState
// ---------------------------------------------------------------------------

describe('trialPillState', () => {
  it('shows the quiet, dismissible pill above 3 days', () => {
    const state = trialPillState(pillInput({ access: access({ state: 'trialing', trialDaysLeft: 14 }) }))
    expect(state).toEqual({ show: true, variant: 'secondary', label: 'Trial, 14 days left', dismissible: true })
  })

  it('escalates to the firm, non-dismissible pill at 3 and 2 days, a distinct tone from the quiet pill', () => {
    for (const days of [3, 2]) {
      const state = trialPillState(pillInput({ access: access({ state: 'trialing', trialDaysLeft: days }) }))
      expect(state, String(days)).toEqual({ show: true, variant: 'caution', label: `${days} days left`, dismissible: false })
    }
  })

  // Mutation target: "skip the singular 1 day left".
  it('reads "1 day left", singular, never "1 days left"', () => {
    const state = trialPillState(pillInput({ access: access({ state: 'trialing', trialDaysLeft: 1 }) }))
    expect(state).toEqual({ show: true, variant: 'caution', label: '1 day left', dismissible: false })
    if (state.show) expect(state.label).not.toBe('1 days left')
  })

  it('renders nothing at 0 days: the frozen bar owns the message from there', () => {
    expect(trialPillState(pillInput({ access: access({ state: 'trialing', trialDaysLeft: 0 }) }))).toEqual({
      show: false,
    })
  })

  // Mutation target: "show the pill to a manager". canSeeBillingChrome is
  // false for a manager (useBilling), so this must hide the pill in every
  // other combination too.
  it('NEVER shows to a role without billing chrome (managers), in any trial-day count', () => {
    for (const days of [14, 5, 3, 2, 1]) {
      for (const dismissed of [true, false]) {
        const state = trialPillState(
          pillInput({ canSeeBillingChrome: false, access: access({ state: 'trialing', trialDaysLeft: days }), dismissed }),
        )
        expect(state, `days=${days} dismissed=${dismissed}`).toEqual({ show: false })
      }
    }
  })

  it('NEVER shows with the flag off', () => {
    for (const days of [14, 3, 1]) {
      expect(trialPillState(pillInput({ uiEnabled: false, access: access({ state: 'trialing', trialDaysLeft: days }) }))).toEqual({
        show: false,
      })
    }
  })

  it('NEVER shows outside the trialing state', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'trialing')) {
      expect(trialPillState(pillInput({ access: access({ state, trialDaysLeft: 7 }) })), state).toEqual({ show: false })
    }
  })

  it('shows nothing while billing state is still loading (access null)', () => {
    expect(trialPillState(pillInput({ access: null }))).toEqual({ show: false })
  })

  // Dismissal only ever applies to the quiet pill (>3 days); the firm pill
  // (<=3 days) ignores it entirely, which is the point of ruling R14.
  it('a session dismissal hides the quiet pill but can never hide the firm one', () => {
    expect(trialPillState(pillInput({ dismissed: true, access: access({ state: 'trialing', trialDaysLeft: 14 }) }))).toEqual({
      show: false,
    })
    for (const days of [3, 2, 1]) {
      const state = trialPillState(pillInput({ dismissed: true, access: access({ state: 'trialing', trialDaysLeft: days }) }))
      expect(state.show, String(days)).toBe(true)
    }
  })

  it('writes no em dash in any label it can produce', () => {
    for (const days of [14, 3, 1]) {
      const state = trialPillState(pillInput({ access: access({ state: 'trialing', trialDaysLeft: days }) }))
      if (state.show) expect(state.label).not.toContain(EM_DASH)
    }
  })

  // Exhaustive: visibility is an AND of three gates plus the day count.
  it('shows exactly for the combinations that satisfy every condition', () => {
    for (const uiEnabled of [true, false]) {
      for (const canSeeBillingChrome of [true, false]) {
        for (const trialDaysLeft of [14, 4, 3, 1, 0]) {
          for (const dismissed of [true, false]) {
            const state = trialPillState(
              pillInput({ uiEnabled, canSeeBillingChrome, dismissed, access: access({ state: 'trialing', trialDaysLeft }) }),
            )
            const firm = trialDaysLeft > 0 && trialDaysLeft <= 3
            const quiet = trialDaysLeft > 3 && !dismissed
            const expected = uiEnabled && canSeeBillingChrome && (firm || quiet)
            const label = `flag=${uiEnabled} chrome=${canSeeBillingChrome} days=${trialDaysLeft} dismissed=${dismissed}`
            expect(state.show, label).toBe(expected)
          }
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// billingBanner
// ---------------------------------------------------------------------------

describe('billingBanner: past_due', () => {
  function pastDue(over: Partial<BillingBannerInput> = {}) {
    return bannerInput({ access: access({ state: 'past_due', frozen: false }), ...over })
  }

  it('gives the owner a critical banner with the Update payment method CTA', () => {
    const spec = billingBanner(pastDue({ isOwner: true }))
    expect(spec).toEqual({
      tone: 'critical',
      message: 'We could not process your last payment. Update your payment method to keep your account active.',
      actions: [{ kind: 'update-payment', label: 'Update payment method', variant: 'outline' }],
    })
  })

  // Mutation target: "revert the banner action to isOwner". Ruling R15 v4:
  // remediation is not purchase, so fixing a failed card is owner AND admin,
  // exactly as Settings and /api/stripe/billing/portal-link already allow.
  it('gives the admin the same message and the SAME live Update payment method CTA', () => {
    const owner = billingBanner(pastDue({ isOwner: true }))
    const admin = billingBanner(pastDue({ isOwner: false, canSeeBillingChrome: true }))
    expect(admin?.tone).toBe('critical')
    expect(admin?.actions).toEqual([{ kind: 'update-payment', label: 'Update payment method', variant: 'outline' }])
    expect(admin).toEqual(owner)
  })

  it('shows nothing to a manager: past_due never blocks bookings, nothing to learn here', () => {
    expect(billingBanner(pastDue({ isOwner: false, canSeeBillingChrome: false }))).toBeNull()
  })
})

describe('billingBanner: frozen, owner', () => {
  it('trial_expired', () => {
    const spec = billingBanner(
      bannerInput({ access: access({ state: 'trial_expired', frozen: true, canExtendTrial: true }) }),
    )
    expect(spec).toEqual({
      tone: 'critical',
      message: 'View-only mode. Your trial ended, so new bookings are paused. Scheduled jobs still run.',
      actions: [
        { kind: 'extend', label: 'Extend seven days', variant: 'outline' },
        { kind: 'choose-plan', label: 'Choose a plan', variant: 'default' },
      ],
    })
  })

  it('omits Extend once the one-time extension is used up', () => {
    const spec = billingBanner(
      bannerInput({ access: access({ state: 'trial_expired', frozen: true, canExtendTrial: false }) }),
    )
    expect(spec?.actions).toEqual([{ kind: 'choose-plan', label: 'Choose a plan', variant: 'default' }])
  })

  it('canceled', () => {
    const spec = billingBanner(bannerInput({ access: access({ state: 'canceled', frozen: true, canExtendTrial: false }) }))
    expect(spec?.message).toBe('View-only mode. Your subscription ended, so new bookings are paused. Scheduled jobs still run.')
    expect(spec?.actions.map((a) => a.kind)).toEqual(['choose-plan'])
  })

  it('paused names the resume date and offers NO actions at all', () => {
    const spec = billingBanner(
      bannerInput({
        access: access({ state: 'paused', frozen: true, canExtendTrial: false }),
        pauseResumesAt: '2026-11-03T00:00:00.000Z',
      }),
    )
    expect(spec).toEqual({
      tone: 'critical',
      message: 'Your account is paused until November 3, 2026. New bookings are paused. Scheduled jobs still run.',
      actions: [],
    })
  })

  it('paused never renders an empty date for a missing or unparseable resume timestamp', () => {
    for (const bad of [null, '', 'not-a-date']) {
      const spec = billingBanner(
        bannerInput({ access: access({ state: 'paused', frozen: true, canExtendTrial: false }), pauseResumesAt: bad }),
      )
      expect(spec?.message, String(bad)).toBe('Your account is paused. New bookings are paused. Scheduled jobs still run.')
      expect(spec?.message).not.toMatch(/until\s*\./)
    }
  })

  // Ruling R22: unpaid is defensive only. It must not crash and must not go
  // silent; it falls back to the trial_expired wording.
  it('unpaid (defensive only, ruling R22) does not go blank and does not throw', () => {
    expect(() => billingBanner(bannerInput({ access: access({ state: 'unpaid', frozen: true, canExtendTrial: false }) }))).not.toThrow()
    const spec = billingBanner(bannerInput({ access: access({ state: 'unpaid', frozen: true, canExtendTrial: false }) }))
    expect(spec?.tone).toBe('critical')
    expect(spec?.message.length).toBeGreaterThan(0)
  })
})

describe('billingBanner: frozen, NOT owner (ruling R2 + R15)', () => {
  const FROZEN_NON_OWNER_MESSAGE =
    'View-only mode. New bookings are paused until the account owner updates the plan. Scheduled jobs still run.'

  // Mutation target: "give a non-owner the pay CTA". This is the branch the
  // brief calls out by name: admin AND manager both land here.
  it('gives the admin the explanation with NO actions', () => {
    const spec = billingBanner(
      bannerInput({ isOwner: false, canSeeBillingChrome: true, access: access({ state: 'trial_expired', frozen: true }) }),
    )
    expect(spec).toEqual({ tone: 'neutral', message: FROZEN_NON_OWNER_MESSAGE, actions: [] })
  })

  // The one R15 exists to protect: a manager, who cannot even see the pill or
  // the trialing banner, MUST still learn why bookings are blocked.
  it('gives the manager (no billing chrome at all) the SAME explanation, with no actions and no chrome gate', () => {
    for (const state of FROZEN_STATES) {
      const spec = billingBanner(
        bannerInput({ isOwner: false, canSeeBillingChrome: false, access: access({ state, frozen: true }) }),
      )
      expect(spec, state).toEqual({ tone: 'neutral', message: FROZEN_NON_OWNER_MESSAGE, actions: [] })
    }
  })

  // Mutation target: "collapse all three severities to one tone". The
  // non-owner frozen tone must differ from the owner's (critical).
  it('uses a DIFFERENT tone than the owner sees for the same frozen state', () => {
    const ownerSpec = billingBanner(bannerInput({ isOwner: true, access: access({ state: 'canceled', frozen: true }) }))
    const nonOwnerSpec = billingBanner(bannerInput({ isOwner: false, access: access({ state: 'canceled', frozen: true }) }))
    expect(ownerSpec?.tone).not.toBe(nonOwnerSpec?.tone)
  })
})

describe('billingBanner: trialing, <=3 days', () => {
  function trialing(days: number, over: Partial<BillingBannerInput> = {}) {
    return bannerInput({ access: access({ state: 'trialing', frozen: false, trialDaysLeft: days, canExtendTrial: true }), ...over })
  }

  it('at 3 and 2 days, owner sees both actions', () => {
    for (const days of [3, 2]) {
      const spec = billingBanner(trialing(days, { isOwner: true }))
      expect(spec?.tone, String(days)).toBe('caution')
      expect(spec?.message, String(days)).toBe(`Your trial ends in ${days} days. Choose a plan to keep booking jobs.`)
      expect(spec?.actions.map((a) => a.kind)).toEqual(['extend', 'choose-plan'])
    }
  })

  // Mutation target: "skip the singular 1 day left" applied to the banner too.
  it('at 1 day, the message reads "tomorrow", not "in 1 days"', () => {
    const spec = billingBanner(trialing(1, { isOwner: true }))
    expect(spec?.message).toBe('Your trial ends tomorrow. After that your account becomes view-only and you cannot add new bookings.')
    expect(spec?.message).not.toContain('in 1 days')
  })

  // Mutation target: "give a non-owner the pay CTA". Admin sees the banner
  // (canSeeBillingChrome), but never the buttons.
  it('admin sees the banner with NO actions', () => {
    const spec = billingBanner(trialing(2, { isOwner: false, canSeeBillingChrome: true }))
    expect(spec?.tone).toBe('caution')
    expect(spec?.actions).toEqual([])
  })

  it('manager (no billing chrome) sees nothing at all during the trial countdown', () => {
    expect(billingBanner(trialing(2, { isOwner: false, canSeeBillingChrome: false }))).toBeNull()
  })

  it('is null above 3 days left: that range belongs to the pill, not the banner', () => {
    expect(billingBanner(trialing(4, { isOwner: true }))).toBeNull()
    expect(billingBanner(trialing(14, { isOwner: true }))).toBeNull()
  })
})

describe('billingBanner: nothing to show', () => {
  it('NEVER shows with the flag off, whatever the state', () => {
    for (const state of ALL_STATES) {
      expect(billingBanner(bannerInput({ uiEnabled: false, access: access({ state, frozen: FROZEN_STATES.includes(state) }) }))).toBeNull()
    }
  })

  it('shows nothing while billing state is loading', () => {
    expect(billingBanner(bannerInput({ access: null }))).toBeNull()
  })

  it('is null for active and comped', () => {
    expect(billingBanner(bannerInput({ access: access({ state: 'active', frozen: false }) }))).toBeNull()
    expect(billingBanner(bannerInput({ access: access({ state: 'comped', frozen: false }) }))).toBeNull()
  })

  it('writes no em dash in any message or action label it can produce', () => {
    const specs = [
      billingBanner(bannerInput({ access: access({ state: 'past_due' }), isOwner: true })),
      billingBanner(bannerInput({ access: access({ state: 'trial_expired', frozen: true, canExtendTrial: true }), isOwner: true })),
      billingBanner(bannerInput({ access: access({ state: 'canceled', frozen: true }), isOwner: true })),
      billingBanner(bannerInput({ access: access({ state: 'paused', frozen: true }), pauseResumesAt: '2026-11-03T00:00:00.000Z', isOwner: true })),
      billingBanner(bannerInput({ access: access({ state: 'trial_expired', frozen: true }), isOwner: false })),
      billingBanner(bannerInput({ access: access({ state: 'trialing', trialDaysLeft: 1 }), isOwner: true })),
    ]
    for (const spec of specs) {
      expect(spec).not.toBeNull()
      expect(spec!.message).not.toContain(EM_DASH)
      for (const action of spec!.actions) expect(action.label).not.toContain(EM_DASH)
    }
  })
})

// ---------------------------------------------------------------------------
// Exactly one banner, ever. This ties billingBanner directly to the real
// deriveBillingAccess so the "two banners could render at once" failure mode
// is checked against the actual state machine, not a hand-picked access
// fixture that might not be reachable.
// ---------------------------------------------------------------------------

describe('exactly one banner (or none), across every reachable billing row', () => {
  const NOW = new Date('2026-09-22T00:00:00.000Z')

  function row(over: Partial<OrgBillingRow>): OrgBillingRow {
    return {
      subscription_status: 'trialing',
      trial_ends_at: null,
      trial_extended_at: null,
      comped_at: null,
      plan_tier: 'starter',
      billing_period: 'monthly',
      seat_count: 3,
      subscription_cancel_at: null,
      billing_paused_at: null,
      billing_pause_resumes_at: null,
      ...over,
    }
  }

  const ROWS: OrgBillingRow[] = [
    row({ comped_at: '2026-01-01T00:00:00.000Z' }),
    row({ billing_paused_at: '2026-09-01T00:00:00.000Z', billing_pause_resumes_at: '2026-10-01T00:00:00.000Z' }),
    row({ subscription_status: 'trialing', trial_ends_at: '2026-10-06T00:00:00.000Z' }), // 14 days
    row({ subscription_status: 'trialing', trial_ends_at: '2026-09-24T12:00:00.000Z' }), // ~3 days
    row({ subscription_status: 'trialing', trial_ends_at: '2026-09-22T12:00:00.000Z' }), // ~1 day
    row({ subscription_status: 'trialing', trial_ends_at: '2026-09-01T00:00:00.000Z' }), // expired
    row({ subscription_status: 'active' }),
    row({ subscription_status: 'past_due' }),
    row({ subscription_status: 'unpaid' }),
    row({ subscription_status: 'canceled' }),
    row({ subscription_status: 'none' }),
  ]

  it('never returns a spec for two different tones from the same input, for any role', () => {
    for (const r of ROWS) {
      const derived = deriveBillingAccess(r, NOW)
      for (const [isOwner, canSeeBillingChrome] of [
        [true, true],
        [false, true],
        [false, false],
      ] as const) {
        // Calling billingBanner is itself the assertion: it is a pure
        // function with early returns, so there is only ever one BannerSpec
        // object or null. This loop's job is to make sure it never throws
        // and that the returned actions are internally consistent with the
        // role: a manager gets nothing at all, and a non-owner never gets a
        // PURCHASE action (ruling R15 v4, remediation is not purchase).
        const spec = billingBanner({
          uiEnabled: true,
          access: derived,
          isOwner,
          canSeeBillingChrome,
          pauseResumesAt: r.billing_pause_resumes_at,
        })
        const label = `${r.subscription_status}/${isOwner}/${canSeeBillingChrome}`
        if (spec && !canSeeBillingChrome) {
          expect(spec.actions, label).toEqual([])
        }
        if (spec && !isOwner) {
          // 'update-payment' is the banner's only remediation kind today.
          expect(spec.actions.map((a) => a.kind).filter((k) => k !== 'update-payment'), label).toEqual([])
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Wiring: the renderers cannot be mounted (no component-rendering setup, no
// @testing-library/react by standing decision). These static checks are the
// only guard that TrialPill.tsx, BillingBanners.tsx, OperatorTopBar.tsx and
// OperatorShell.tsx are actually wired the way the model above assumes. Each
// maps to a specific mutation that would otherwise ship silently.
// ---------------------------------------------------------------------------

/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('TrialPill wiring', () => {
  const source = readFileSync(new URL('./TrialPill.tsx', import.meta.url), 'utf8')
  const clean = code(source)

  it('decides visibility in trialPillState, once, and honours the answer', () => {
    expect(clean).toMatch(/trialPillState\(\{/)
    expect(clean).not.toMatch(/access\??\.trialDaysLeft\s*[<>=]/)
  })

  it('reads canSeeBillingChrome from useBilling, not a hand-rolled role check', () => {
    expect(clean).toMatch(/useBilling\(\)/)
    expect(clean).toContain('canSeeBillingChrome')
    expect(clean).not.toMatch(/currentOrgRole\s*===\s*['"]owner['"]/)
  })

  // Mutation target: sessionStorage throwing must still render the pill.
  it('wraps every sessionStorage read and write in try/catch', () => {
    const tryBlocks = clean.match(/try\s*\{[\s\S]*?\}\s*catch/g) ?? []
    const guarded = tryBlocks.filter((b) => b.includes('sessionStorage'))
    expect(guarded.length, 'expected at least a read and a write guarded').toBeGreaterThanOrEqual(2)
    // No unguarded sessionStorage access outside those blocks.
    const withoutTryBlocks = tryBlocks.reduce((s, b) => s.replace(b, ''), clean)
    expect(withoutTryBlocks).not.toContain('sessionStorage')
  })

  it('uses the exact dismissal key nexxus.trialPillDismissed', () => {
    expect(source).toContain('nexxus.trialPillDismissed')
  })

  // Mutation target: responsive discipline lost, mobile top bar overflows.
  it('carries the hidden sm:inline-flex discipline the New booking button uses', () => {
    expect(source).toMatch(/hidden sm:inline-flex/)
  })

  it('writes no raw hex colour and no em dash', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toContain(EM_DASH)
  })
})

describe('BillingBanners wiring', () => {
  const source = readFileSync(new URL('./BillingBanners.tsx', import.meta.url), 'utf8')
  const clean = code(source)

  it('decides its spec in billingBanner, once, and renders nothing else when null', () => {
    expect(clean).toMatch(/billingBanner\(\{/)
    expect(clean).toMatch(/if \(!spec\) return null/)
  })

  it('renders at most one ShellBanner: exactly one JSX use, no duplicate return paths', () => {
    // Word-bounded so `Record<ShellBannerTone, ...>` (the icon map's type
    // annotation) does not count as a second use.
    const uses = clean.match(/<ShellBanner[\s>]/g) ?? []
    expect(uses.length).toBe(1)
  })

  // Mutation target: "make the frozen bar dismissible". NONE of this ladder's
  // banners are dismissible (ruling R14): no onDismiss must ever be wired.
  it('NEVER passes onDismiss to ShellBanner: nothing in this ladder is dismissible (ruling R14)', () => {
    expect(clean).not.toContain('onDismiss')
  })

  it('feeds billingBanner every input from the hook, including the flag and the role checks', () => {
    const call = clean.match(/billingBanner\(\{([\s\S]*?)\}\)/)![1]
    for (const field of ['uiEnabled', 'access', 'isOwner', 'canSeeBillingChrome', 'pauseResumesAt']) {
      expect(call, field).toContain(field)
    }
    expect(call).not.toMatch(/(uiEnabled|isOwner|canSeeBillingChrome):\s*(true|false)/)
  })

  it('opens the paywall through the shared store function, not a local re-implementation', () => {
    expect(clean).toContain('openPaywall(')
    expect(clean).not.toContain('usePaywall(')
  })

  it('routes the Update payment method CTA through getPortalUrl, not a hand-built URL', () => {
    expect(clean).toContain('getPortalUrl(')
  })

  it('writes no raw hex colour and no em dash', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toContain(EM_DASH)
  })
})

describe('OperatorTopBar mount', () => {
  const source = readFileSync(
    new URL('../shell/OperatorTopBar.tsx', import.meta.url),
    'utf8',
  )
  // Comment-stripped: the file's own top-of-file JSDoc mentions "New booking"
  // in prose, long before the actual button, which would otherwise make this
  // check pass for the wrong reason.
  const clean = code(source)

  it('mounts TrialPill before the New booking button, inside the right cluster', () => {
    const pillAt = clean.indexOf('<TrialPill')
    const bookingAt = clean.indexOf('New booking')
    expect(pillAt, 'TrialPill not mounted').toBeGreaterThan(-1)
    expect(bookingAt, 'New booking button not found').toBeGreaterThan(-1)
    expect(pillAt).toBeLessThan(bookingAt)
  })
})

describe('OperatorShell mount', () => {
  const source = readFileSync(
    new URL('../shell/OperatorShell.tsx', import.meta.url),
    'utf8',
  )

  it('mounts BillingBanners immediately after the impersonation banner: impersonation reads first', () => {
    expect(source).toMatch(/<RedesignImpersonationBanner\s*\/>\s*\n\s*<BillingBanners\s*\/>/)
  })
})
