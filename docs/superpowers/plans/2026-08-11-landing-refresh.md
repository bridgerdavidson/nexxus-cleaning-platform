# Landing Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three landing-page pieces from `docs/superpowers/specs/2026-08-11-landing-refresh-design.md`: locked pricing numbers, the docked-to-floating-pill top bar, and the interactive white-label demo section.

**Architecture:** All work is client-side marketing UI on the `(marketing)/landing` route. Pricing math becomes a pure module with unit tests; the nav morph is a boolean scroll threshold driving a one-shot CSS class transition; the branding demo scopes the production `--brand-*` CSS-variable ramp (via `src/lib/branding/palette.ts`) to a tableau of existing demo frames.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v3 tokens (`tailwind.config.js` + `src/app/globals.css`), Vitest 3 unit project, Playwright screenshots for visual verification.

## Global Constraints

- **No em dashes** in any user-facing copy string.
- **Design-system tokens only** in shipped components (no raw hex in classes/styles). Exception, per spec: the three preset brand hexes and the color-picker value are *data* feeding `deriveBrandRamp`; they live in one constants block in `BrandingSection.tsx` and inline `style={{ backgroundColor }}` swatches rendering that data.
- **Do NOT run `npm run test`, `npm run test:integration`, or `npx supabase db reset` until the messaging session's all-clear** (cross-session hold, 2026-08-11: Bridger is validating against local Supabase and resets/integration runs truncate his seeded demo users). Unit runs (`npm run test:unit`) only.
- Pricing numbers are OWNED by `~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-pricing-decision.md`. If a number here disagrees with that doc, the doc wins.
- Branch: `feat/landing-refresh`. Commit per task; no push until session end (Bridger batches one PR).
- Dev server for visual checks is already running on **http://localhost:3300** (do not start another; port 3000 errors out because of it).
- The Playwright MCP browser may be locked by another session; use the node-script pattern (Task 6) with the repo's own Playwright via absolute-path import.

---

### Task 1: Pricing data + math module (pure, TDD)

**Files:**
- Create: `src/components/marketing/pricing.ts`
- Test: `src/components/marketing/pricing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 2 imports these): `type BillingPeriod = 'annual' | 'monthly'`; `interface PricingTier { name: string; blurb: string; bases: Record<BillingPeriod, number>; includedSeats: number; cap: number | null; capNeeds: string | null; features: string[]; popular?: boolean }`; `const PRICING_TIERS: PricingTier[]`; `const EXTRA_SEAT_PRICE = 10`; `tierTotal(tier: PricingTier, period: BillingPeriod, cleaners: number): number`; `overCap(tier: PricingTier, cleaners: number): boolean`.

- [ ] **Step 1: Write the failing test** at `src/components/marketing/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EXTRA_SEAT_PRICE, PRICING_TIERS, overCap, tierTotal } from './pricing'

const [starter, growth, pro] = PRICING_TIERS

describe('PRICING_TIERS', () => {
  it('matches the locked 2026-07-26 pricing decision', () => {
    expect(PRICING_TIERS.map((t) => t.name)).toEqual(['Starter', 'Growth', 'Pro'])
    expect(starter.bases).toEqual({ annual: 29, monthly: 39 })
    expect(growth.bases).toEqual({ annual: 79, monthly: 99 })
    expect(pro.bases).toEqual({ annual: 139, monthly: 169 })
    expect(PRICING_TIERS.map((t) => t.includedSeats)).toEqual([3, 8, 15])
    expect(PRICING_TIERS.map((t) => t.cap)).toEqual([5, 15, null])
    expect(EXTRA_SEAT_PRICE).toBe(10)
  })
  it('keeps copy free of em dashes', () => {
    const strings = PRICING_TIERS.flatMap((t) => [t.name, t.blurb, ...t.features])
    for (const s of strings) expect(s).not.toContain('—')
  })
})

describe('tierTotal', () => {
  it('charges the base alone at or under the included seats', () => {
    expect(tierTotal(starter, 'annual', 3)).toBe(29)
    expect(tierTotal(starter, 'monthly', 1)).toBe(39)
    expect(tierTotal(growth, 'annual', 8)).toBe(79)
    expect(tierTotal(pro, 'monthly', 15)).toBe(169)
  })
  it('adds a flat $10 per seat beyond included', () => {
    expect(tierTotal(starter, 'annual', 5)).toBe(29 + 2 * EXTRA_SEAT_PRICE)
    expect(tierTotal(growth, 'monthly', 10)).toBe(99 + 2 * EXTRA_SEAT_PRICE)
    expect(tierTotal(pro, 'annual', 20)).toBe(139 + 5 * EXTRA_SEAT_PRICE)
  })
})

describe('overCap', () => {
  it('flags Starter above 5 and Growth above 15, at the boundary not before', () => {
    expect(overCap(starter, 5)).toBe(false)
    expect(overCap(starter, 6)).toBe(true)
    expect(overCap(growth, 15)).toBe(false)
    expect(overCap(growth, 16)).toBe(true)
  })
  it('never flags Pro (unlimited)', () => {
    expect(overCap(pro, 25)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- src/components/marketing/pricing.test.ts`
Expected: FAIL, cannot resolve `./pricing`.

- [ ] **Step 3: Implement `src/components/marketing/pricing.ts`:**

```ts
// Pricing source of truth: the brain doc
// ~/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-pricing-decision.md
// (locked 2026-07-26). Numbers here mirror it; change them only with a logged
// decision there. Annual is the default display ("billed annually").

export type BillingPeriod = 'annual' | 'monthly'

export interface PricingTier {
  name: string
  blurb: string
  /** Per-month sticker price at each billing period. */
  bases: Record<BillingPeriod, number>
  includedSeats: number
  /** Hard seat cap before an upgrade is required; null = unlimited. */
  cap: number | null
  /** Tier name shown in the over-cap state ("Needs Growth"). */
  capNeeds: string | null
  features: string[]
  popular?: boolean
}

export const EXTRA_SEAT_PRICE = 10

export const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Starter',
    blurb: 'For solo operators and first hires.',
    bases: { annual: 29, monthly: 39 },
    includedSeats: 3,
    cap: 5,
    capNeeds: 'Growth',
    features: [
      'The whole core product, no feature strip-down',
      'Online booking and scheduling, including recurring visits',
      'Homeowner and cleaner apps',
      'Card payments with automatic cleaner payouts',
      'In-app messaging and notifications',
      'Your own branding on everything (white-label)',
      'Standard support',
    ],
  },
  {
    name: 'Growth',
    blurb: 'For companies ready to stop doing office work at night.',
    bases: { annual: 79, monthly: 99 },
    includedSeats: 8,
    cap: 15,
    capNeeds: 'Pro',
    popular: true,
    features: [
      'Everything in Starter',
      'ACH payments (0.8% capped at $5, at cost)',
      'Cancellation and no-show fee tooling',
      'Analytics dashboard',
      'Priority support',
      'New features land here first',
    ],
  },
  {
    name: 'Pro',
    blurb: 'For established crews with managers and payroll.',
    bases: { annual: 139, monthly: 169 },
    includedSeats: 15,
    cap: null,
    capNeeds: null,
    features: [
      'Everything in Growth',
      'Unlimited cleaner seats',
      'White-glove onboarding',
      'Free data migration',
      'First access to AI features as they ship',
    ],
  },
]

export function tierTotal(tier: PricingTier, period: BillingPeriod, cleaners: number): number {
  return tier.bases[period] + Math.max(0, cleaners - tier.includedSeats) * EXTRA_SEAT_PRICE
}

export function overCap(tier: PricingTier, cleaners: number): boolean {
  return tier.cap != null && cleaners > tier.cap
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- src/components/marketing/pricing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/marketing/pricing.ts src/components/marketing/pricing.test.ts
git commit -m "feat(marketing): locked pricing data + tier math with tests"
```

---

### Task 2: PricingSection rewrite

**Files:**
- Modify: `src/components/marketing/PricingSection.tsx` (full rewrite of the data usage; section shell, slider card, and Reveal wrapper stay)

**Interfaces:**
- Consumes (from Task 1): `PRICING_TIERS`, `EXTRA_SEAT_PRICE`, `tierTotal`, `overCap`, `BillingPeriod`, `PricingTier`.
- Consumes (existing): `SegmentedControl` from `@/components/ui/segmented-control` (`options: {value, label}[]`, `value`, `onChange`), `AnimatedNumber`, `Slider`, `Card`, `Badge`, `Button`, `Label`, `Reveal`.
- Produces: nothing downstream.

- [ ] **Step 1: Rewrite the component.** Delete the local `Tier` interface, `TIERS` array, `tierTotal` helper, and the "Placeholder early-access numbers" comment block. New body (keep the existing section shell `<section id="pricing" ...>` and the crew-slider `Card` exactly as they are):

```tsx
'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'
import { Reveal } from './Reveal'
import { PRICING_TIERS, overCap, tierTotal, type BillingPeriod } from './pricing'

export function PricingSection() {
  const [cleaners, setCleaners] = React.useState(5)
  const [period, setPeriod] = React.useState<BillingPeriod>('annual')
  // ...section header unchanged down to the slider Card...
```

Between the slider `Card` and the tier grid, add the toggle (centered):

```tsx
<div className="mt-8 flex justify-center">
  <SegmentedControl<BillingPeriod>
    options={[
      { value: 'annual', label: 'Billed annually' },
      { value: 'monthly', label: 'Billed monthly' },
    ]}
    value={period}
    onChange={setPeriod}
  />
</div>
```

Tier cards map over `PRICING_TIERS`. Price area becomes cap-aware:

```tsx
{PRICING_TIERS.map((tier) => {
  const total = tierTotal(tier, period, cleaners)
  const extras = Math.max(0, cleaners - tier.includedSeats)
  const over = overCap(tier, cleaners)
  return (
    <Card key={tier.name} className={cn('relative flex flex-col p-6', tier.popular && 'border-2 border-primary shadow-soft-lg')}>
      {tier.popular ? (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">Most popular</Badge>
      ) : null}
      <h3 className="text-lg font-bold text-foreground">{tier.name}</h3>
      <p className="mt-1 min-h-10 text-sm text-muted-foreground">{tier.blurb}</p>
      {over ? (
        <div className="mt-4 min-h-[72px]">
          <p className="text-2xl font-extrabold tracking-tight text-foreground">Needs {tier.capNeeds}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {tier.name} supports up to {tier.cap} cleaners
          </p>
        </div>
      ) : (
        <div className="mt-4 min-h-[72px]">
          <p className="text-4xl font-extrabold tracking-tight text-foreground tnum">
            <AnimatedNumber value={total} prefix="$" />
            <span className="ml-1 text-base font-semibold text-muted-foreground">/mo</span>
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground tnum">
            {extras > 0
              ? `$${tier.bases[period]} base + ${extras} extra ${extras === 1 ? 'seat' : 'seats'} at $${EXTRA_SEAT_PRICE}`
              : `${tier.includedSeats} cleaner seats included`}
            {period === 'annual' ? ', billed annually' : ''}
          </p>
        </div>
      )}
      <ul className="mt-5 grid flex-1 content-start gap-2.5">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-positive-700" aria-hidden />
            {feature}
          </li>
        ))}
      </ul>
      <Button variant={tier.popular && !over ? 'default' : 'outline'} className="mt-6 w-full" asChild>
        <a href="#waitlist">Join the waitlist</a>
      </Button>
    </Card>
  )
})}
```

Footnote block replaces the current one entirely:

```tsx
<div className="mx-auto mt-8 max-w-2xl space-y-1.5 text-center text-sm font-medium text-muted-foreground">
  <p>Every plan starts with a 14 day free trial at the Growth level. No credit card required.</p>
  <p>1% platform fee on jobs paid through the platform, and it includes paying your cleaners automatically. We only make money when you do.</p>
  <p>Card processing at cost (2.9% + 30&cent;), zero markup. Your customers never pay a fee.</p>
</div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i "marketing\|pricing" || echo CLEAN`
Expected: CLEAN (pre-existing unrelated errors may exist elsewhere; none in marketing files).

- [ ] **Step 3: Visual sanity check** on http://localhost:3300 (scroll to `#pricing`): toggle flips 29/79/139 to 39/99/169; slider at 6 puts Starter in "Needs Growth"; slider at 16 puts Growth in "Needs Pro"; slider at 25 leaves Pro priced ($239 annual).

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/PricingSection.tsx
git commit -m "feat(marketing): pricing section on locked numbers with billing toggle and honest caps"
```

---

### Task 3: `useScrolledPast` + MarketingNav morph

**Files:**
- Create: `src/lib/useScrolledPast.ts`
- Modify: `src/components/marketing/MarketingNav.tsx`

**Interfaces:**
- Produces: `useScrolledPast(threshold: number): boolean` (generic; other sticky chrome may reuse it).
- Consumes (existing): `Logo`, `Button`, `cn`.

**Spec deviation, deliberate:** the spec suggested an IntersectionObserver sentinel; a passive scroll listener that only flips a boolean at the threshold gives the identical one-shot class toggle without coupling the nav to a sentinel element in the hero. Style changes still occur only at the crossing (React bails out on same-value sets).

- [ ] **Step 1: Create the hook** at `src/lib/useScrolledPast.ts`:

```ts
'use client'

import * as React from 'react'

/**
 * True once the window has scrolled past `threshold` px. The listener is
 * passive and only ever sets a boolean, so scrolling never re-renders per
 * frame; state flips exactly at the crossing (React bails on same-value sets).
 */
export function useScrolledPast(threshold: number): boolean {
  const [past, setPast] = React.useState(false)
  React.useEffect(() => {
    const onScroll = () => setPast(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return past
}
```

- [ ] **Step 2: Rewrite `MarketingNav.tsx`.** `LINKS` and all three content elements (logo, links, actions) are unchanged; only the wrappers change:

```tsx
'use client'

import Link from 'next/link'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useScrolledPast } from '@/lib/useScrolledPast'

const LINKS = [
  { href: '#try-it', label: 'How it works' },
  { href: '#live-tracking', label: 'Live tracking' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

/** Past roughly the hero headline: the docked chrome detaches into the pill. */
const FLOAT_AT = 360

export function MarketingNav() {
  const floating = useScrolledPast(FLOAT_AT)
  return (
    // Constant 64px box in both states: content below never shifts and the
    // sections' scroll-mt-16 anchor offsets stay correct. The pill floats
    // inside this box.
    <header className="sticky top-0 z-40 h-16">
      <div
        className={cn(
          'mx-auto bg-card transition-all duration-slow ease-out-soft motion-reduce:transition-none',
          floating
            ? 'mt-2 h-12 w-[calc(100%-24px)] max-w-4xl rounded-pill border border-border shadow-soft-lg'
            : 'h-16 w-full rounded-none border-b border-border',
        )}
      >
        <div
          className={cn(
            'mx-auto flex h-full w-full max-w-6xl items-center justify-between',
            floating ? 'px-3 sm:px-5' : 'px-4 sm:px-6',
          )}
        >
          <Link href="#top" aria-label="Nexxus home" className="flex items-center">
            <Logo variant="full" className="h-8" priority />
          </Link>
          <nav className="hidden items-center gap-7 md:flex" aria-label="Page sections">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-semibold text-muted-foreground transition-colors duration-base hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <a href="#waitlist">Join the waitlist</a>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i "MarketingNav\|useScrolledPast" || echo CLEAN`
Expected: CLEAN.

- [ ] **Step 4: Visual check both states** on http://localhost:3300: at top, solid white full-width bar with hairline; after scrolling ~400px, inset pill with shadow; morph animates smoothly; no content jump at the crossing; logo/buttons fit inside the h-12 pill (the `h-8` logo leaves 8px breathing room).

- [ ] **Step 5: Commit**

```bash
git add src/lib/useScrolledPast.ts src/components/marketing/MarketingNav.tsx
git commit -m "feat(marketing): top bar morphs from docked app chrome to floating pill"
```

---

### Task 4: BrandingSection (tableau, theme bar, live repaint) + page wiring

**Files:**
- Create: `src/components/marketing/BrandingSection.tsx`
- Modify: `src/app/(marketing)/landing/page.tsx` (one import + one line between `FlexibilitySection` and `PricingSection`)

**Interfaces:**
- Consumes: `deriveBrandRamp`, `rampToCssVars` from `@/lib/branding/palette`; `orgInitials` from `@/lib/branding/monogram`; `BrowserFrame`, `PhoneFrame` from `./frames` (`BrowserFrame` props: `label`, `appBar?`, `rail?`, `children`; `PhoneFrame` props: `initials`, `tabs: LucideIcon[]`, `className`, `children`); `Badge`, `cn`, `Reveal`.
- Produces (Task 5 extends this file): component-local `PRESETS: { name: string; hex: string }[]`, state setters `setBrand`, and the theme-bar wrapper element (Task 5 attaches interaction capture + the cycle timer).

- [ ] **Step 1: Create the component.** Full file:

```tsx
'use client'

import * as React from 'react'
import { CalendarDays, Camera, Check, CreditCard, Home, MessageSquare, Settings, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { deriveBrandRamp, rampToCssVars } from '@/lib/branding/palette'
import { orgInitials } from '@/lib/branding/monogram'
import { cn } from '@/lib/utils'
import { BrowserFrame, PhoneFrame } from './frames'

interface BrandPreset {
  name: string
  hex: string
}

// Demo identities. These hexes are DATA, not styling: they feed the production
// deriveBrandRamp pipeline exactly like a tenant's saved brand color does.
const PRESETS: BrandPreset[] = [
  { name: 'Sparkle & Co', hex: '#0FA47A' },
  { name: 'Summit Shine', hex: '#E86A2C' },
  { name: 'Bluebird Home', hex: '#7C5CFF' },
]

const RAIL_ITEMS = [
  { label: 'Overview', Icon: Home },
  { label: 'Calendar', Icon: CalendarDays },
  { label: 'Crew', Icon: Users },
  { label: 'Payments', Icon: CreditCard },
  { label: 'Messages', Icon: MessageSquare },
]

/** Expanded operator rail at sketch scale: lockup with the live company name,
 * labeled nav (first item active in brand), settings pinned to the bottom. */
function ExpandedDemoRail({ name }: { name: string }) {
  const display = name.trim() || 'Your Company'
  return (
    <div className="flex w-32 shrink-0 flex-col gap-1 border-r border-border bg-card p-2" aria-hidden>
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <span className="grid size-5 shrink-0 place-items-center rounded-chip bg-primary text-[8px] font-extrabold text-primary-foreground transition-colors duration-slow">
          {orgInitials(display)}
        </span>
        <span className="truncate text-[10px] font-bold text-foreground">{display}</span>
      </div>
      {RAIL_ITEMS.map(({ label, Icon }, i) => (
        <span
          key={label}
          className={cn(
            'flex items-center gap-1.5 rounded-chip px-1.5 py-1 text-[9px] font-semibold transition-colors duration-slow',
            i === 0 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-3 shrink-0" />
          {label}
        </span>
      ))}
      <span className="mt-auto flex items-center gap-1.5 px-1.5 py-1 text-[9px] font-semibold text-muted-foreground">
        <Settings className="size-3 shrink-0" />
        Settings
      </span>
    </div>
  )
}

function DemoLine({ className }: { className?: string }) {
  return <span className={cn('block h-1.5 rounded-pill bg-muted', className)} />
}

export function BrandingSection() {
  const [brand, setBrand] = React.useState<BrandPreset>(PRESETS[0])

  // The production theming engine, scoped to the tableau below.
  const brandVars = React.useMemo(
    () => rampToCssVars(deriveBrandRamp(brand.hex)) as React.CSSProperties,
    [brand.hex],
  )

  const display = brand.name.trim() || 'Your Company'
  const domain = display.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'yourcompany'

  return (
    <section id="white-label" className="scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="secondary">White-label</Badge>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Your customers see your brand. Not ours.
          </h2>
          <p className="mt-3 text-base font-medium text-muted-foreground">
            Pick a color, type your name, and the whole platform wears it. Included on every plan.
          </p>
        </div>

        {/* Tableau: everything inside this wrapper repaints from the brand vars. */}
        <div style={brandVars} className="relative mx-auto mt-10 max-w-2xl" aria-hidden>
          <BrowserFrame label={`app.${domain}.com`} rail={<ExpandedDemoRail name={brand.name} />} className="mr-14 sm:mr-24">
            <div className="space-y-2 p-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Today', value: '6' },
                  { label: 'In progress', value: '2' },
                  { label: 'This month', value: '$12.4k' },
                ].map((k) => (
                  <div key={k.label} className="rounded-control border border-border bg-card p-2">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{k.label}</p>
                    <p className="text-sm font-extrabold text-foreground tnum">{k.value}</p>
                  </div>
                ))}
              </div>
              {[
                { w: 'w-24', pill: 'Scheduled', brand: true },
                { w: 'w-32', pill: 'Done', brand: false },
                { w: 'w-28', pill: 'In progress', brand: true },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between rounded-control border border-border bg-card px-2.5 py-2">
                  <DemoLine className={row.w} />
                  <span
                    className={cn(
                      'rounded-pill px-2 py-0.5 text-[8px] font-bold transition-colors duration-slow',
                      row.brand ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {row.pill}
                  </span>
                </div>
              ))}
            </div>
          </BrowserFrame>

          <PhoneFrame
            initials={orgInitials(display)}
            tabs={[Home, CalendarDays, Camera, CreditCard]}
            className="absolute -bottom-6 right-0 z-10 w-36 sm:w-40"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-chip bg-primary text-[8px] font-extrabold text-primary-foreground transition-colors duration-slow">
                  {orgInitials(display)}
                </span>
                <span className="truncate text-[10px] font-bold text-foreground">{display}</span>
              </div>
              <div className="rounded-control border border-border bg-card p-2">
                <p className="text-[9px] font-bold text-foreground">2:00 PM &middot; Deep clean</p>
                <DemoLine className="mt-1.5 w-4/5" />
                <DemoLine className="mt-1 w-3/5" />
              </div>
              <span className="block rounded-pill bg-primary py-1.5 text-center text-[10px] font-bold text-primary-foreground transition-colors duration-slow">
                Start job
              </span>
            </div>
          </PhoneFrame>
        </div>

        {/* Theme bar: the visitor's controls. Deliberately OUTSIDE the brand-vars
            wrapper so the controls themselves stay in Nexxus chrome. */}
        <div className="mx-auto mt-12 flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-card border border-border bg-card px-3 py-2 shadow-soft-md sm:rounded-pill">
          {PRESETS.map((p) => {
            const active = brand.name === p.name && brand.hex === p.hex
            return (
              <button
                key={p.name}
                type="button"
                aria-pressed={active}
                onClick={() => setBrand(p)}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-pill border px-3 text-sm font-semibold transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-transparent bg-accent text-accent-foreground ring-2 ring-ring'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="size-3 rounded-pill" style={{ backgroundColor: p.hex }} />
                {p.name}
                {active ? <Check className="size-4" aria-hidden /> : null}
              </button>
            )
          })}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-border px-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Brand color</span>
            <span className="relative size-6 overflow-hidden rounded-pill border border-border" style={{ backgroundColor: brand.hex }}>
              <input
                type="color"
                value={brand.hex}
                onChange={(e) => setBrand((b) => ({ ...b, hex: e.target.value }))}
                aria-label="Pick your brand color"
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded-pill border border-border px-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Company name</span>
            <input
              type="text"
              value={brand.name}
              maxLength={24}
              onChange={(e) => setBrand((b) => ({ ...b, name: e.target.value }))}
              className="w-32 border-0 bg-transparent p-0 text-sm font-semibold text-foreground focus:outline-none focus:ring-0"
            />
          </label>
        </div>

        <p className="mt-6 text-center text-sm font-medium text-muted-foreground">
          Some platforms charge $197 a month to take their logo off. Here it is included.
        </p>
      </div>
    </section>
  )
}
```

Notes for the implementer:
- `bg-primary` / `text-primary-foreground` / `bg-accent` / `ring-ring` all chain to `--brand-*` in `globals.css`, which is exactly why the vars wrapper repaints them. Do not "fix" them to `bg-brand-600`; both work, but `primary` matches how real app chrome is written.
- One preset hex is intentionally NOT the Nexxus blue so the section visibly differs from the rest of the page at rest.
- The `#0FA47A`-style values appear only in `PRESETS` and the two swatch `style` props rendering them (see Global Constraints).

- [ ] **Step 2: Wire into the page.** In `src/app/(marketing)/landing/page.tsx` add the import and render between `FlexibilitySection` and `PricingSection`:

```tsx
import { BrandingSection } from '@/components/marketing/BrandingSection'
// ...
        <Reveal><FlexibilitySection /></Reveal>
        <Reveal><BrandingSection /></Reveal>
        <PricingSection />
```

(No new nav link; the bar is full at `md` already. Spec left this to the implementer.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i "Branding" || echo CLEAN`
Expected: CLEAN.

- [ ] **Step 4: Visual check** on http://localhost:3300 at `#white-label`: presets repaint the rail lockup, active nav item, status pills, phone header, and Start job button; typing a name updates both lockups and the monogram initials; the color input repaints continuously while dragging; theme bar wraps to two rows at 375px without horizontal scroll.

- [ ] **Step 5: Commit**

```bash
git add src/components/marketing/BrandingSection.tsx "src/app/(marketing)/landing/page.tsx"
git commit -m "feat(marketing): white-label demo section with live brand repaint"
```

---

### Task 5: Idle preset cycle (in-view + reduced-motion gated)

**Files:**
- Modify: `src/components/marketing/BrandingSection.tsx`

**Interfaces:**
- Consumes: `useReducedMotion` from `motion/react` (already a dependency; `FlowShowcase` uses it), plus Task 4's `PRESETS` / `setBrand` / section root.
- Produces: nothing downstream.

- [ ] **Step 1: Add the cycle.** Inside `BrandingSection`, after the `brand` state:

```tsx
import { useReducedMotion } from 'motion/react'   // add to imports

  const sectionRef = React.useRef<HTMLElement>(null)
  const [interacted, setInteracted] = React.useState(false)
  const [inView, setInView] = React.useState(false)
  const reduced = useReducedMotion() ?? false

  // Cycle only while the section is actually on screen.
  React.useEffect(() => {
    const node = sectionRef.current
    if (!node) return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 })
    io.observe(node)
    return () => io.disconnect()
  }, [])

  // Idle brand cycle: stops permanently on first interaction, never runs under
  // reduced motion, pauses offscreen.
  React.useEffect(() => {
    if (interacted || reduced || !inView) return
    const timer = setInterval(() => {
      setBrand((prev) => {
        const i = PRESETS.findIndex((p) => p.name === prev.name && p.hex === prev.hex)
        return PRESETS[(i + 1) % PRESETS.length] ?? PRESETS[0]
      })
    }, 4000)
    return () => clearInterval(timer)
  }, [interacted, reduced, inView])
```

Attach `ref={sectionRef}` to the `<section>` element, and interaction capture to the theme-bar wrapper div:

```tsx
<div
  onPointerDownCapture={() => setInteracted(true)}
  onFocusCapture={() => setInteracted(true)}
  className="mx-auto mt-12 flex w-fit ..."   // existing classes unchanged
>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -i "Branding" || echo CLEAN`
Expected: CLEAN.

- [ ] **Step 3: Visual check** on http://localhost:3300: idle on the section, brands rotate every 4s with smooth color transitions; clicking any control stops the rotation for good; scrolling away and back does not resume after an interaction; with OS reduced-motion emulated the section rests on Sparkle & Co.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/BrandingSection.tsx
git commit -m "feat(marketing): idle brand cycle for the white-label demo"
```

---

### Task 6: Verification sweep + conformance pass

**Files:**
- Create (scratchpad, not committed): `<scratchpad>/shots-landing.mjs`

- [ ] **Step 1: Gates** (unit only; integration is on hold per Global Constraints):

```bash
npm run test:unit -- src/components/marketing/pricing.test.ts
npx tsc --noEmit
npm run lint
```

Expected: pricing tests PASS; tsc/lint introduce nothing new in `src/components/marketing/**`, `src/lib/useScrolledPast.ts`.

- [ ] **Step 2: Screenshot script.** Write `<scratchpad>/shots-landing.mjs` (the absolute-path import dodges the scratchpad's lack of node_modules; the MCP browser may be locked by another session):

```js
import { chromium } from '/Users/bridgerdavidson/Builds/nexxus-cleaning-platform/node_modules/playwright/index.mjs'

const OUT = process.argv[2]
const browser = await chromium.launch()

for (const [w, h, tag] of [[1280, 800, 'desktop'], [375, 812, 'mobile']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto('http://localhost:3300', { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT}/nav-docked-${tag}.png` })
  await page.mouse.wheel(0, 800)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/nav-floating-${tag}.png` })

  await page.locator('#white-label').scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/branding-idle-${tag}.png` })
  await page.getByRole('button', { name: 'Summit Shine' }).click()
  await page.getByLabel('Company name').fill('Maple Maids')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/branding-custom-${tag}.png` })

  await page.locator('#pricing').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/pricing-annual-${tag}.png` })
  await page.getByRole('tab', { name: 'Billed monthly' }).click()
  await page.locator('#crew-size').fill('16')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/pricing-monthly-capped-${tag}.png` })
  await page.close()
}
await browser.close()
console.log('done')
```

Run it, then READ every screenshot and check against the spec's states (both nav states, branding idle vs customized, pricing annual vs monthly + cap states, no horizontal overflow at 375px).

- [ ] **Step 3: Conformance pass** (ui-feature-workflow requirement):

```bash
grep -rn "#[0-9A-Fa-f]\{3,8\}" src/components/marketing/BrandingSection.tsx src/components/marketing/MarketingNav.tsx src/components/marketing/PricingSection.tsx src/components/marketing/pricing.ts
```

Expected hits: ONLY the `PRESETS` hexes and the two swatch `style` props in `BrandingSection.tsx`. Anything else is a mockup-styling leak; fix it. Also re-run the ui-ux-pro-max checklist (implementation phase): touch targets &ge;44px in the theme bar, visible labels on both inputs, selection not conveyed by color alone, reduced-motion honored in both new animations, em-dash grep:

```bash
grep -rn "—" src/components/marketing/ || echo "no em dashes"
```

- [ ] **Step 4: Fix anything found, re-run the relevant gate, commit**

```bash
git add -A src/components/marketing src/lib/useScrolledPast.ts
git commit -m "chore(marketing): landing refresh verification fixes"
```

(Skip the commit if Step 4 found nothing.)

---

## Self-Review

- **Spec coverage:** §1 nav → Task 3; §2 branding (tableau, theme bar, mechanism, idle cycle, copy, wiring) → Tasks 4-5; §3 pricing (numbers, toggle, caps, features, footnote) → Tasks 1-2; testing/verification section → Task 6. The spec's "billed annually" note renders in the price sub-line (Task 2 Step 1).
- **Placeholder scan:** clean; every code step carries the actual code.
- **Type consistency:** `PricingTier.bases[period]` used in Task 2 matches Task 1's `Record<BillingPeriod, number>`; `BrandPreset {name, hex}` consistent across Tasks 4-5; `useScrolledPast(threshold: number): boolean` consumed once.
