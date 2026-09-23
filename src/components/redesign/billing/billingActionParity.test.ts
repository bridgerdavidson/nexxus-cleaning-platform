// Ruling R15 v4: REMEDIATION IS NOT PURCHASE.
//
// This file exists because the bug it guards against was not "the banner has
// the wrong role check". The bug was that ONE capability, "open the Stripe
// Customer Portal", was decided twice, in two files, and the two answers
// drifted: Settings handed an admin a live Update payment method button while
// the shell banner handed the same admin nothing. An enumerated pair of cases
// would drift again the next time an action is added, so the invariant itself
// is the test:
//
//   For a given role, the set of ENABLED portal actions in the shell banner
//   and in Settings > Plan and billing must agree.
//
//   PURCHASE actions (Choose a plan, Change plan, Extend) alter what is owed.
//   Owner only, everywhere, and disabled-with-a-reason for an admin rather
//   than hidden.
//
//   REMEDIATION actions (Update payment method, Reactivate, invoices) keep an
//   existing agreement alive. Owner AND admin, live, on every surface, because
//   an owner on holiday must not be able to freeze a business the admin
//   running it day to day is powerless to rescue.
//
//   A manager gets the explanation and no actions at all. A cleaner never
//   reaches either surface.
//
// The two models are exercised through their real inputs, over the rows
// deriveBillingAccess can actually produce, so no case here is a fiction.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { billingBanner, type BannerAction } from './billingBannersModel'
import {
  actionStateFor,
  billingSectionView,
  OWNER_ONLY_REASON,
  type BillingSectionAction,
} from './billingSectionModel'
import { deriveSettingsSections } from '../settings/sections'
import { deriveBillingAccess, type BillingAccess, type OrgBillingRow } from '@/lib/billing/access'

type Role = 'owner' | 'admin' | 'manager'

/** Ordered, so an audience can be compared with toEqual and read as a list. */
const ROLES: readonly Role[] = ['owner', 'admin', 'manager']

/**
 * The ruling, written out HERE rather than imported from either model. If the
 * classification lived in the code and the test read it back, reclassifying an
 * action would silently reclassify the test with it, and this whole file would
 * pass against the bug it exists to catch. The classification below is pinned
 * to the shipped renderers by the wiring block at the bottom of this file.
 */
const PORTAL_KINDS = ['portal', 'update-payment', 'reactivate']
const PURCHASE_KINDS = ['choose-plan', 'change-plan', 'extend']

const isPortal = (a: { kind: string }) => PORTAL_KINDS.includes(a.kind)
const isPurchase = (a: { kind: string }) => PURCHASE_KINDS.includes(a.kind)

const NOW = new Date('2026-09-22T00:00:00.000Z')
const PERIOD_END = '2026-10-21T12:00:00.000Z'

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

/** Every reachable billing state, as real rows rather than hand-built access. */
const ROWS: { label: string; row: OrgBillingRow }[] = [
  { label: 'comped', row: row({ comped_at: '2026-01-01T00:00:00.000Z' }) },
  {
    label: 'paused',
    row: row({
      billing_paused_at: '2026-09-01T00:00:00.000Z',
      billing_pause_resumes_at: '2026-10-01T00:00:00.000Z',
    }),
  },
  { label: 'trialing (14 days)', row: row({ trial_ends_at: '2026-10-06T00:00:00.000Z' }) },
  { label: 'trialing (1 day)', row: row({ trial_ends_at: '2026-09-22T12:00:00.000Z' }) },
  { label: 'trial_expired', row: row({ trial_ends_at: '2026-09-01T00:00:00.000Z' }) },
  { label: 'trial_expired (status none)', row: row({ subscription_status: 'none' }) },
  { label: 'active', row: row({ subscription_status: 'active' }) },
  {
    label: 'active (cancelling)',
    row: row({ subscription_status: 'active', subscription_cancel_at: '2026-11-03T00:00:00.000Z' }),
  },
  { label: 'past_due', row: row({ subscription_status: 'past_due' }) },
  { label: 'unpaid', row: row({ subscription_status: 'unpaid' }) },
  { label: 'canceled', row: row({ subscription_status: 'canceled' }) },
]

/**
 * What the shell banner actually hands this role. The banner has no disabled
 * state: an action it renders is an action the role can use.
 */
function bannerEnabledActions(access: BillingAccess, role: Role, pauseResumesAt: string | null): BannerAction[] {
  const spec = billingBanner({
    uiEnabled: true,
    access,
    isOwner: role === 'owner',
    // Exactly what useBilling derives: owner or admin.
    canSeeBillingChrome: role === 'owner' || role === 'admin',
    pauseResumesAt,
  })
  return spec?.actions ?? []
}

/**
 * Whether this role can open Settings > Plan and billing at all. Settings
 * gates the SECTION in the nav registry and the ACTIONS inside it with
 * actionStateFor, so a role that cannot reach the section has no enabled
 * action there whatever the model says.
 *
 * The role pair is the real one: accept-invite stamps an org owner's
 * user_profiles.role as 'admin' (`role === 'owner' ? 'admin' : role`), and
 * deriveSettingsSections matches UserRole and OrgRole additively.
 */
function settingsReachableBy(role: Role): boolean {
  const userRole = role === 'owner' ? 'admin' : role
  return deriveSettingsSections(userRole, role, null).some((s) => s.id === 'billing')
}

function settingsEnabledActions(access: BillingAccess, role: Role, r: OrgBillingRow): BillingSectionAction[] {
  if (!settingsReachableBy(role)) return []
  return settingsModelActions(access, role, r)
}

/**
 * The same thing WITHOUT the registry gate: what the model alone would hand
 * this role if the section rendered for them. Ruling R24 moved the manager
 * answer out of the nav registry and into the model, so this is the function
 * that proves a registry change could not reopen the hole.
 */
function settingsModelActions(access: BillingAccess, role: Role, r: OrgBillingRow): BillingSectionAction[] {
  const view = billingSectionView({
    uiEnabled: true,
    isLoading: false,
    access,
    // Exactly what useBilling derives, same as the banner above.
    canSeeBillingChrome: role === 'owner' || role === 'admin',
    seatsInUse: 4,
    tier: 'growth',
    period: 'monthly',
    seatCount: r.seat_count,
    currentPeriodEnd: PERIOD_END,
    cancelAt: r.subscription_cancel_at,
    pauseResumesAt: r.billing_pause_resumes_at,
  })
  if (view.kind !== 'plan') return []
  return view.spec.actions.filter((a) => !actionStateFor(a, role === 'owner').disabled)
}

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

describe('one capability, one answer: portal access across the banner and Settings', () => {
  // Mutation target: "revert the banner action to isOwner", which is the
  // original bug. It leaves the banner audience as ['owner'] while Settings
  // keeps ['owner', 'admin'].
  it('offers the Stripe portal to exactly the same roles on both surfaces, in every billing state', () => {
    let bannerOffers = 0
    let settingsOffers = 0
    let compared = 0

    for (const { label, row: r } of ROWS) {
      const access = deriveBillingAccess(r, NOW)
      const bannerAudience = ROLES.filter((role) =>
        bannerEnabledActions(access, role, r.billing_pause_resumes_at).some(isPortal),
      )
      const settingsAudience = ROLES.filter((role) => settingsEnabledActions(access, role, r).some(isPortal))

      // A surface that offers remediation at all offers it to owner AND
      // admin: never to one of the two, never to a manager.
      if (bannerAudience.length) {
        bannerOffers += 1
        expect(bannerAudience, `banner/${label}`).toEqual(['owner', 'admin'])
      }
      if (settingsAudience.length) {
        settingsOffers += 1
        expect(settingsAudience, `settings/${label}`).toEqual(['owner', 'admin'])
      }
      // And where both surfaces carry it, they never disagree about who.
      if (bannerAudience.length && settingsAudience.length) {
        compared += 1
        expect(bannerAudience, `banner vs settings/${label}`).toEqual(settingsAudience)
      }
    }

    // Guards against the whole loop passing vacuously if the portal action
    // ever stops being produced at all.
    expect(bannerOffers, 'no state offered the portal in the banner').toBeGreaterThan(0)
    expect(settingsOffers, 'no state offered the portal in Settings').toBeGreaterThanOrEqual(3)
    expect(compared, 'no state exercised the cross-surface comparison').toBeGreaterThan(0)
  })

  // Mutation target: "give an admin a live Change plan button" (or a live
  // Extend, or a live Choose a plan) on either surface.
  it('offers every purchase action to the owner alone, on both surfaces', () => {
    let bannerOffers = 0
    let settingsOffers = 0

    for (const { label, row: r } of ROWS) {
      const access = deriveBillingAccess(r, NOW)
      const bannerAudience = ROLES.filter((role) =>
        bannerEnabledActions(access, role, r.billing_pause_resumes_at).some(isPurchase),
      )
      const settingsAudience = ROLES.filter((role) => settingsEnabledActions(access, role, r).some(isPurchase))

      if (bannerAudience.length) {
        bannerOffers += 1
        expect(bannerAudience, `banner/${label}`).toEqual(['owner'])
      }
      if (settingsAudience.length) {
        settingsOffers += 1
        expect(settingsAudience, `settings/${label}`).toEqual(['owner'])
      }
    }

    expect(bannerOffers, 'no state offered a purchase action in the banner').toBeGreaterThan(0)
    expect(settingsOffers, 'no state offered a purchase action in Settings').toBeGreaterThanOrEqual(3)
  })

  // Mutation target: "hide the purchase controls from an admin instead of
  // disabling them". Settings decides the LIST without a role, so the admin
  // is shown every control the owner is shown; only its state differs.
  it('shows an admin every purchase control the owner sees, disabled with the reason, never hidden', () => {
    let seen = 0
    for (const { label, row: r } of ROWS) {
      const access = deriveBillingAccess(r, NOW)
      const view = billingSectionView({
        uiEnabled: true,
        isLoading: false,
        access,
        canSeeBillingChrome: true,
        seatsInUse: 4,
        tier: 'growth',
        period: 'monthly',
        seatCount: r.seat_count,
        currentPeriodEnd: PERIOD_END,
        cancelAt: r.subscription_cancel_at,
        pauseResumesAt: r.billing_pause_resumes_at,
      })
      expect(view.kind, label).toBe('plan')
      if (view.kind !== 'plan') continue

      for (const action of view.spec.actions.filter(isPurchase)) {
        seen += 1
        // Present in the list the admin renders from, and disabled there with
        // the reason, not absent from it.
        expect(actionStateFor(action, false), `${label}/${action.kind}`).toEqual({
          disabled: true,
          reason: OWNER_ONLY_REASON,
        })
        expect(actionStateFor(action, true), `${label}/${action.kind}`).toEqual({
          disabled: false,
          reason: null,
        })
      }
    }
    expect(seen, 'no purchase control was produced at all').toBeGreaterThanOrEqual(5)
  })

  // Mutation target: "give a manager any action at all", on either surface.
  // A manager who cannot create a booking must still learn why, which is why
  // the frozen explanation stays; it just carries nothing to click.
  it('gives a manager the explanation and no action at all, on either surface, in every state', () => {
    expect(settingsReachableBy('manager'), 'Settings > Plan and billing must stay owner/admin').toBe(false)

    let explained = 0
    for (const { label, row: r } of ROWS) {
      const access = deriveBillingAccess(r, NOW)
      expect(bannerEnabledActions(access, 'manager', r.billing_pause_resumes_at), `banner/${label}`).toEqual([])
      expect(settingsEnabledActions(access, 'manager', r), `settings/${label}`).toEqual([])
      // Ruling R24: and not merely because the registry hides the section.
      // Mutation target: "add manager to the billing section's roles", which
      // used to be all it took to hand a manager a live portal button.
      expect(settingsModelActions(access, 'manager', r), `settings model/${label}`).toEqual([])

      const spec = billingBanner({
        uiEnabled: true,
        access,
        isOwner: false,
        canSeeBillingChrome: false,
        pauseResumesAt: r.billing_pause_resumes_at,
      })
      if (access.frozen) {
        expect(spec, `frozen/${label} must still explain itself`).not.toBeNull()
        expect(spec!.message.length, label).toBeGreaterThan(0)
        explained += 1
      }
    }
    expect(explained, 'no frozen state was checked for the manager explanation').toBeGreaterThanOrEqual(4)
  })
})

// ---------------------------------------------------------------------------
// Wiring: what actually opens the portal.
//
// The classification at the top of this file is only worth something if the
// shipped renderers route those kinds, and only those kinds, into the Stripe
// portal. These checks read the renderers with comments stripped, so a rule
// stated in prose can never satisfy one.
// ---------------------------------------------------------------------------

function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function kindLiterals(body: string): string[] {
  return [...body.matchAll(/["']([a-z-]+)["']/g)].map((m) => m[1]).sort()
}

describe('the renderers route exactly the classified kinds into the portal', () => {
  const sectionSource = code(
    readFileSync(new URL('../settings/sections/BillingSection.tsx', import.meta.url), 'utf8'),
  )
  const bannerSource = code(readFileSync(new URL('./BillingBanners.tsx', import.meta.url), 'utf8'))

  it('Settings sends every kind except the picker pair and extend to the portal', () => {
    const body = sectionSource.match(/function handleAction\(action: BillingSectionAction\): void \{([\s\S]*?)\n {2}\}/)
    expect(body, 'handleAction not found in BillingSection.tsx').not.toBeNull()
    // Only the purchase kinds are named; the fallback branch is the portal, so
    // portal, update-payment and reactivate all land there.
    expect(kindLiterals(body![1])).toEqual(['change-plan', 'choose-plan', 'extend'])
    expect(body![1]).toMatch(/else void openPortal\(action\.kind\)/)
    expect(sectionSource).toMatch(/async function openPortal[\s\S]*?getPortalUrl\(/)
  })

  it('the banner sends update-payment, and only update-payment, to the portal', () => {
    const body = bannerSource.match(/function handleAction\(action: BannerAction\): void \{([\s\S]*?)\n {2}\}/)
    expect(body, 'handleAction not found in BillingBanners.tsx').not.toBeNull()
    expect(kindLiterals(body![1])).toEqual(['choose-plan', 'extend', 'update-payment'])
    expect(body![1]).toContain('handleUpdatePayment()')
    expect(bannerSource).toMatch(/async function handleUpdatePayment[\s\S]*?getPortalUrl\(/)
  })

  // Mutation target: "filter the actions by role in the renderer", the other
  // way to hide a control from an admin without touching the model.
  it('neither renderer filters its action list by role', () => {
    for (const [name, source] of [
      ['BillingSection.tsx', sectionSource],
      ['BillingBanners.tsx', bannerSource],
    ] as const) {
      expect(source, name).toMatch(/spec\.actions\.map\(/)
      expect(source, name).not.toMatch(/spec\.actions\s*\n?\s*\.filter\(/)
      expect(source, name).not.toMatch(/spec\.actions\s*\n?\s*\.slice\(/)
      expect(source, name).not.toContain('ownerOnly')
    }
  })
})
