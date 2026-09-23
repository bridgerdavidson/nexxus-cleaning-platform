# Phase 1b PR F: Billing UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every operator-facing billing surface (paywall, view-only bar, trial pill and banners, Settings > Billing, seat controls) plus the two read endpoints they need, all dark behind `NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED`.

**Architecture:** Two new read-only API routes (`GET /api/billing/state`, `POST /api/billing/plan/preview`) feed one TanStack Query hook. `deriveBillingAccess` runs unchanged on the client, so "frozen" keeps exactly one definition. One `PlanPicker` component is mounted in two places (the paywall and Settings). Two new design-system primitives (`Stepper`, `ShellBanner`) are added because PR F would otherwise hand-roll four banners and a quantity control.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query v5, Tailwind v3, Stripe Node SDK `20.1.2` (`apiVersion: '2025-12-15.clover'`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-saas-billing-design.md` (§7 states, §12 client integration, §13 UX, §20 build model)

**Design session:** `2026-09-21`, run through `ui-feature-workflow` + `superpowers:brainstorming` visual companion + `ui-ux-pro-max` (design phase). Mockups persisted at `.superpowers/brainstorm/18406-1790047937/content/`. Research reports at `scratchpad/research/01..06`. The decisions those produced are recorded per-task below and summarised in **Design Rulings**.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Branch:** `feat/phase1b-billing-ui`, stacked on `feat/phase1b-stripe-billing` (PR E, #278). PR E and PR D (#277) are OPEN and UNMERGED. Do not merge, rebase onto master, or touch either branch.
- **Flag-dark:** every new UI surface renders `null` unless `billingEnforcementUiEnabled()` returns true. The two new API routes are readable regardless (they are reads, they change nothing).
- **No em dashes (`—`) in ANY user-facing string.** UI text, labels, buttons, toasts, errors. Use a period, comma, parentheses, or "to" for ranges. This is a hard repo rule and is checked at review.
- **Design system only.** Build from `src/components/ui/*` primitives and the tokens in `tailwind.config.js` + `src/app/globals.css`. **Never copy styling from the companion mockups** (they are UX/structure reference only) and never write a raw hex value in a component. Brand is `#0150FC` via `--brand-600`; reach it through semantic tokens (`bg-primary`, `text-primary`), never literally.
  - Note: CLAUDE.md's line about "primary is the brand yellow `#F7C41E`" is STALE. That is the legacy `primary.*` ramp in `tailwind.config.js`. The live semantic token is `--primary: var(--brand-600)` (`globals.css:489`).
- **Light and dark themes both required.** Follow the `dark:` token pairs already established in `src/components/ui/badge.tsx`.
- **Touch targets >= 44px**; `Button` size `default` is `h-11` and already complies. Mobile-first; no horizontal scroll at 375px.
- **Money is integer cents everywhere.** Never float. Format for display only at the render boundary.
- **Build model tiering** (memory `build-model-tiering`, spec §20): tasks marked **[Opus]** touch money, multiple files, or price arithmetic. Tasks marked **[Sonnet]** are mechanical or fixed-design. The model is named per task; use it.
- **Every new API route needs a co-located `*.integration.test.ts`**; every new pure function in `src/lib/**` needs a co-located `*.test.ts`.
- **Pre-push gates:** `npm run test`, `npx tsc --noEmit`, `npm run lint`.
- **Commit trailer, every commit:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
  ```

---

## Design Rulings

Settled during the design session. Implementers must not re-litigate these; they are inputs, not suggestions.

| # | Ruling | Why |
|---|---|---|
| R1 | Paywall is one screen with a live summary rail, not a two-step wizard | Approved by Bridger. The rail carries the exact charge and renewal date, so disclosure costs no extra step |
| R2 | The paywall and all pay CTAs are **owner only**. Admins and managers get an explanation bar with no CTA | Bridger's explicit call. Prevents the Asana failure where staff hit dead controls with no reason given |
| R3 | Settings > Billing is a compact current-plan summary with a **Change plan** button that opens the picker, NOT a permanent pricing table | Research: dominant pattern across Slack and a 44-example gallery. Also means `PlanPicker` is built once, mounted twice |
| R4 | The monthly/annual toggle defaults to **monthly** | The "annual default lifts 20-30%" claim is untraceable to any study. Defaulting a price-sensitive SMB into the larger charge is the StubHub surprise pattern (-44.58% at the purchase step) |
| R5 | **Pre-select** the tier that fits their headcount. No "Recommended"/"Most popular" ribbon | Pre-selection is the measured lever; badging is not. "Fits your 6 cleaners" is true about them, not promotional |
| R6 | A tier too small for their headcount is **greyed with an inline reason plus a one-click fix** | Keeps spec §13's greyed-with-reason. Research's objection was really about Calendry's *vague* message, not about greying |
| R7 | **Always show a prominent total.** Itemise freely above it | Abraham & Hamilton, JMR 2018, N=12,878: partitioned pricing favours the seller ONLY when the total is absent |
| R8 | The previewed total **must include tax** when `BILLING_TAX_ENABLED` is on | A $99.00 summary followed by a $107.17 Stripe page is exactly the StubHub failure at the step we control |
| R9 | **No trust badges, seals, logos, countdowns, or guarantee graphics** | Evidence of absence of effect: seals null in a covert field experiment; time-based scarcity delta=0.02, p=.896. The working trust signal is the recognisable Stripe/Apple Pay surface |
| R10 | Keep **hosted** Stripe Checkout. No change to PR E | No credible hosted-vs-embedded experiment exists. Hosted maintains wallets, SCA, tax and card UX for us, and this codebase already uses it |
| R11 | "Cancel anytime" appears on **monthly only** | It would be misleading on an annual commitment |
| R12 | Trial extension stays, but **secondary in the hierarchy**, never a primary CTA | A 337,724-person RCT found 14-day and 30-day trials statistically indistinguishable, so the extension is not a conversion lever. It is a good-faith service affordance |
| R13 | Severity ladder is **three steps**, mapped to existing Badge tones: neutral pill (days 14-4), caution banner (3-1), critical (0 / frozen / past_due) | Avoids a binary jump. Uses tokens that already exist |
| R14 | Pill is dismissible per session. The <=3-day banner, frozen bar and past_due banner are **not dismissible** | NN/g: a message about an unresolved problem should not vanish on a click |
| R15 | **v4, 2026-09-22.** Four audiences. (a) The trial **PILL**: owner + admin, it is information. (b) **PURCHASE actions** (Choose a plan, Change plan, Extend trial) alter what is owed: **owner only**. An admin sees them disabled with the tooltip "Only the account owner can change the plan.", never hidden. (c) **REMEDIATION actions** (Update payment method, Reactivate, view invoices) keep an existing agreement alive rather than changing it: **owner + admin**, live in BOTH Settings and the shell banner. (d) The frozen bar's **EXPLANATION** additionally reaches MANAGERS with no actions (that is R2). Cleaners see none of it | v3 collapsed (b) and (c) into "every action is owner only", which produced the same capability answering differently in two places: Settings gave an admin a live Update payment method button while the banner gave none. `/api/stripe/billing/portal-link` already allows `['owner','admin']`. Bridger's call: an admin may fix a failed card but not change the plan, so the owner being on holiday cannot freeze a business nobody is able to rescue |
| R16 | At the seat cap, resolve **inline in the invite dialog**, owner only. Never redirect to Billing | Jobber (our direct competitor) and Calendly both do this. Non-owners get "ask your account owner" |
| R17 | The seat dialog shows the **new monthly total**, not just the delta | Silent or vague seat charges are what generated public complaints against ClickUp and Loom |
| R18 | The homeowner block message gives a **route around the block** (the company's own phone), never mentions billing, and never 404s | No vendor does this well. Shopify makes the storefront vanish; GoDaddy's parked page looks hacked |
| R19 | The billing query opts into `refetchOnWindowFocus: true` **locally**. Do not change the global default | Global is `false` (`src/lib/queryClient.ts:7`) by design. Without the local opt-in, a past_due banner stays on screen after the user has already paid in the Stripe tab |
| R20 | Wallets on, **ACH explicitly excluded** in the Checkout Session | ACH is supported for subscriptions and we pass no `payment_method_types`, so a Dashboard toggle would enable it in production with zero code change. An ACH subscription stays `active` after a failed debit, which would unfreeze an org we could not re-freeze. Spec §10.8 |
| R21 | **Revised 2026-09-22 (v2).** Money copy follows the COMPUTED AMOUNT, not the direction. `due_now_cents` is always whatever `summarizePreviewInvoice` returns; nothing is forced to zero. The total's label is `Charged today` when that figure is above zero and `Nothing is charged today` when it is zero, whatever `direction` says. `direction` still drives the supporting sentence (a downgrade explains the credit), never the headline number | v1 forced `due_now_cents: 0` for any non-upgrade, which OVERRODE arithmetic that was already correct. `summarizePreviewInvoice` splits invoice lines by period against a pinned `proration_date` and applies `starting_balance`: a pure downgrade's proration lines are negative and floor to zero on their own, while an **annual to monthly** switch resets the billing cycle so its new-period line legitimately lands in the due-now bucket. v1 would have printed "Nothing is charged today" on a screen where Stripe may well invoice |
| R22 | The `unpaid` branch is **defensive only**. Build it, do not design for it | Spec §7.1: dunning now ends by cancelling, so a lapsed customer lands in `canceled` and buys again through Checkout. `unpaid` should never occur; if it does, the Dashboard config has drifted |
| R23 | The preview endpoint MUST reuse PR E's direction logic and its shared `readCurrentItems`, never its own copy | Two copies of "is this an upgrade" that can drift is exactly how the preview comes to quote a different number than the change applies |

---

## File Structure

### Created

| File | Responsibility |
|---|---|
| `src/components/ui/stepper.tsx` | Generic numeric stepper primitive. No billing knowledge |
| `src/components/ui/stepper.test.tsx` | Clamping, disabled bounds, a11y |
| `src/components/ui/shell-banner.tsx` | Full-bleed shell banner primitive, `neutral \| info \| caution \| critical` |
| `src/app/api/billing/state/route.ts` | `GET` the org billing row + seats in use. Read-only |
| `src/app/api/billing/state/route.integration.test.ts` | Role gating, shape, seats-in-use accuracy |
| `src/app/api/billing/plan/preview/route.ts` | `POST` a Stripe proration preview. Read-only, never mutates |
| `src/app/api/billing/plan/preview/route.integration.test.ts` | Preview arithmetic, tax inclusion, no-live-sub path |
| `src/lib/billing/format.ts` | `formatCents`, `formatRenewal`, `planSummaryLine`. Pure |
| `src/lib/billing/format.test.ts` | Formatting edge cases |
| `src/hooks/useBilling.ts` | One hook: billing row, derived access, role flags, seats |
| `src/components/redesign/billing/PlanPicker.tsx` | Tier cards + period toggle + seat stepper + summary rail |
| `src/components/redesign/billing/BillingPaywall.tsx` | Full-screen interstitial (owner only) |
| `src/components/redesign/billing/BillingBanners.tsx` | Pill, trial banner, frozen bar, past_due banner |
| `src/components/redesign/billing/SeatCapDialog.tsx` | Inline add-a-seat / upgrade dialog |
| `src/components/redesign/billing/CheckoutReturn.tsx` | `checkout=success` polling and `checkout=canceled` |
| `src/components/redesign/settings/sections/BillingSection.tsx` | Settings > Billing, eight state branches |
| `src/components/redesign/billing/billing-api.ts` | Client fetch helpers for the billing routes |
| `tests/e2e/billing-paywall.spec.ts` | Frozen operator sees wall, escapes to read-only, extends |

### Modified

| File | Change |
|---|---|
| `src/components/redesign/shell/OperatorShell.tsx:115,124` | Mount banners above the top bar; wrap `<main>` with the paywall |
| `src/components/redesign/shell/OperatorTopBar.tsx:76,80` | Trial pill in the right cluster; New booking opens the paywall when frozen |
| `src/components/redesign/shell/RedesignImpersonationBanner.tsx` | Adopt the new `ShellBanner` primitive |
| `src/components/redesign/settings/sections.ts` | Add the `billing` section id |
| `src/components/redesign/settings/sections/registry.ts` | Register `BillingSection` |
| `src/components/redesign/cleaners/OperatorCleaners.tsx` | "4 of 5 seats" indicator; open `SeatCapDialog` on 409 |
| `src/hooks/useAdminData.ts` | `inviteTeamMember` returns the status and 409 body instead of collapsing them (this, NOT `useInvites.ts`, is the send path) |
| `src/types/index.ts` | `Organization` gains `contact_phone` |
| `supabase/migrations/<generated>_add_org_contact_phone.sql` | The column behind ruling R18 |
| `src/components/redesign/homeowner/booking/useSubmitBookingRequest.ts` | Handle 402 with the R18 message |
| `src/lib/queryKeys.ts` | Add `billing.preview(orgId, selection)` |

---

## Task List

Fifteen tasks. Tasks 1 and 2 are independent and may be batched into one dispatch. Task 15 is independent of all the others and may run at any point.

---

### Task 1: `Stepper` primitive **[Sonnet]**

No quantity control exists anywhere in the repo (`grep -rn "stepper\|Stepper" src/` finds only an unrelated marketing component). PR F needs one in three places, so it is built as a design-system primitive rather than inlined.

**Files:**
- Create: `src/components/ui/stepper.tsx`
- Test: `src/components/ui/stepper.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, `Button` from `@/components/ui/button`
- Produces:
  ```ts
  export interface StepperProps {
    value: number
    min: number
    max: number | null          // null = unbounded above
    onChange: (next: number) => void
    label: string               // visually hidden, for screen readers
    minReason?: string          // announced when a decrement is refused
    disabled?: boolean
  }
  export function Stepper(props: StepperProps): JSX.Element
  ```

> **Revised 2026-09-22.** The original version of this task tested the rendered component with
> `@testing-library/react`. That package is **not installed** (check `package.json`), and the
> unit project runs in `environment: 'node'` (`vitest.config.mts`), so the test could not run at
> all. Rather than add a UI testing stack to this PR, the clamping logic moves into a pure
> exported function and THAT is what gets tested. The component becomes a thin renderer over it.
> This is the same split used in Task 6 (`planPickerModel.ts`), so it matches a pattern the plan
> already establishes.

**Additional export from this task:**

```ts
/** Pure. Returns the value the stepper should move to, or null when the move is refused. */
export function nextStepperValue(
  current: number, delta: 1 | -1, min: number, max: number | null,
): number | null
```

- [ ] **Step 1: Write the failing test**

```ts
// src/components/ui/stepper.test.ts   (.ts, NOT .tsx: no rendering)
import { describe, it, expect } from 'vitest'
import { nextStepperValue } from './stepper'

describe('nextStepperValue', () => {
  it('refuses to go below min', () => {
    expect(nextStepperValue(6, -1, 6, 15)).toBeNull()
  })
  it('refuses to go above max', () => {
    expect(nextStepperValue(15, 1, 6, 15)).toBeNull()
  })
  it('treats a null max as unbounded', () => {
    expect(nextStepperValue(99, 1, 1, null)).toBe(100)
  })
  it('steps within bounds', () => {
    expect(nextStepperValue(8, 1, 6, 15)).toBe(9)
    expect(nextStepperValue(8, -1, 6, 15)).toBe(7)
  })
  it('refuses any move when min equals max', () => {
    expect(nextStepperValue(5, 1, 5, 5)).toBeNull()
    expect(nextStepperValue(5, -1, 5, 5)).toBeNull()
  })
})
```

The component's own accessibility contract (`role="spinbutton"`, `aria-valuenow`, arrow keys,
`minReason`) is still REQUIRED by the implementation below. It is verified by the Task 14 E2E
spec and by manual check, not by a unit test, because this repo has no component-rendering
setup and PR F is not the place to add one.

<details>
<summary>Superseded: the original rendering test, kept so nobody re-adds it by mistake</summary>

```tsx
// DO NOT USE. @testing-library/react is not installed and the unit project is node-environment.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Stepper } from './stepper'

describe('Stepper', () => {
  it('clamps at min and does not call onChange', () => {
    const onChange = vi.fn()
    render(<Stepper value={6} min={6} max={15} onChange={onChange} label="Cleaner seats" />)
    fireEvent.click(screen.getByRole('button', { name: /decrease/i }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clamps at max and does not call onChange', () => {
    const onChange = vi.fn()
    render(<Stepper value={15} min={6} max={15} onChange={onChange} label="Cleaner seats" />)
    fireEvent.click(screen.getByRole('button', { name: /increase/i }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats a null max as unbounded', () => {
    const onChange = vi.fn()
    render(<Stepper value={99} min={1} max={null} onChange={onChange} label="Seats" />)
    fireEvent.click(screen.getByRole('button', { name: /increase/i }))
    expect(onChange).toHaveBeenCalledWith(100)
  })

  it('increments and decrements within bounds', () => {
    const onChange = vi.fn()
    render(<Stepper value={8} min={6} max={15} onChange={onChange} label="Seats" />)
    fireEvent.click(screen.getByRole('button', { name: /increase/i }))
    expect(onChange).toHaveBeenCalledWith(9)
    fireEvent.click(screen.getByRole('button', { name: /decrease/i }))
    expect(onChange).toHaveBeenCalledWith(7)
  })

  it('exposes the value to assistive tech as a spinbutton', () => {
    render(<Stepper value={8} min={6} max={15} onChange={() => {}} label="Cleaner seats" />)
    const sb = screen.getByRole('spinbutton', { name: 'Cleaner seats' })
    expect(sb).toHaveAttribute('aria-valuenow', '8')
    expect(sb).toHaveAttribute('aria-valuemin', '6')
    expect(sb).toHaveAttribute('aria-valuemax', '15')
  })

  it('renders minReason when at the floor', () => {
    render(
      <Stepper value={6} min={6} max={15} onChange={() => {}} label="Seats"
        minReason="You have 6 cleaners. Remove one first." />,
    )
    expect(screen.getByText('You have 6 cleaners. Remove one first.')).toBeInTheDocument()
  })
})
```

```

</details>

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/components/ui/stepper.test.ts`
Expected: FAIL, "Failed to resolve import ./stepper"

- [ ] **Step 3: Implement**

```tsx
// src/components/ui/stepper.tsx
'use client'

import * as React from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StepperProps {
  value: number
  min: number
  /** null means unbounded above. */
  max: number | null
  onChange: (next: number) => void
  /** Visually hidden accessible name. */
  label: string
  /** Shown beneath the control when value === min. */
  minReason?: string
  disabled?: boolean
  className?: string
}

export function Stepper({
  value, min, max, onChange, label, minReason, disabled = false, className,
}: StepperProps) {
  const atMin = value <= min
  const atMax = max !== null && value >= max

  const btn =
    'inline-flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors ' +
    'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4'

  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <div className="inline-flex items-center overflow-hidden rounded-pill border border-border bg-card">
        <button
          type="button" className={btn} onClick={() => onChange(value - 1)}
          disabled={disabled || atMin} aria-label={`Decrease ${label}`}
        >
          <Minus aria-hidden />
        </button>
        <span
          role="spinbutton" aria-label={label} aria-valuenow={value}
          aria-valuemin={min} {...(max !== null ? { 'aria-valuemax': max } : {})}
          tabIndex={0}
          className="min-w-10 px-1 text-center text-sm font-bold tabular-nums text-foreground
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'ArrowUp' && !atMax) { e.preventDefault(); onChange(value + 1) }
            if (e.key === 'ArrowDown' && !atMin) { e.preventDefault(); onChange(value - 1) }
          }}
        >
          {value}
        </span>
        <button
          type="button" className={btn} onClick={() => onChange(value + 1)}
          disabled={disabled || atMax} aria-label={`Increase ${label}`}
        >
          <Plus aria-hidden />
        </button>
      </div>
      {atMin && minReason ? (
        <p className="text-xs text-muted-foreground">{minReason}</p>
      ) : null}
    </div>
  )
}
```

Notes for the implementer:
- `tabular-nums` prevents the control resizing as the digit count changes.
- Arrow-key support is what makes `role="spinbutton"` honest; do not drop it.
- `rounded-pill` and `border-border` are existing tokens. Do not substitute raw values.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/components/ui/stepper.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/stepper.tsx src/components/ui/stepper.test.ts
git commit -m "feat(ui): add Stepper primitive for quantity controls"
```

---

### Task 2: `ShellBanner` primitive, and adopt it in the impersonation banner **[Sonnet]**

PR F adds four full-bleed shell banners. `RedesignImpersonationBanner` already hand-rolls one. Five hand-rolled banners is exactly the case the `ui-feature-workflow` skill says to formalise.

**Files:**
- Create: `src/components/ui/shell-banner.tsx`
- Modify: `src/components/redesign/shell/RedesignImpersonationBanner.tsx` (whole file)

**Interfaces:**
- Produces:
  ```ts
  export type ShellBannerTone = 'neutral' | 'info' | 'caution' | 'critical'
  export interface ShellBannerProps {
    tone: ShellBannerTone
    icon?: React.ReactNode
    children: React.ReactNode          // the message
    actions?: React.ReactNode          // buttons, rendered right
    onDismiss?: () => void             // omit to make it non-dismissible
    dismissLabel?: string
  }
  export function ShellBanner(props: ShellBannerProps): JSX.Element
  ```

- [ ] **Step 1: Implement the primitive**

```tsx
// src/components/ui/shell-banner.tsx
'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ShellBannerTone = 'neutral' | 'info' | 'caution' | 'critical'

const TONES: Record<ShellBannerTone, string> = {
  neutral:  'border-border bg-muted text-foreground',
  info:     'border-info/50 bg-info-50 text-info-700 dark:bg-info/15 dark:text-info',
  caution:  'border-caution/50 bg-caution-50 text-caution-700 dark:bg-caution/15 dark:text-caution',
  critical: 'border-critical/50 bg-critical-50 text-critical-700 dark:bg-critical/15 dark:text-destructive',
}

export interface ShellBannerProps {
  tone: ShellBannerTone
  icon?: React.ReactNode
  children: React.ReactNode
  actions?: React.ReactNode
  /** Omit to make the banner non-dismissible. */
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}

export function ShellBanner({
  tone, icon, children, actions, onDismiss, dismissLabel = 'Dismiss', className,
}: ShellBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b px-4 py-2',
        'text-center text-sm font-medium',
        TONES[tone],
        className,
      )}
    >
      <span className="inline-flex items-center gap-2">
        {icon ? <span className="shrink-0 [&_svg]:size-4" aria-hidden>{icon}</span> : null}
        {children}
      </span>
      {actions ? <span className="inline-flex items-center gap-2">{actions}</span> : null}
      {onDismiss ? (
        <button
          type="button" onClick={onDismiss} aria-label={dismissLabel}
          className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-pill
                     opacity-70 transition-opacity hover:opacity-100
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
        >
          <X aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
```

Implementer notes:
- The tone classes mirror `src/components/ui/badge.tsx` exactly, so the banner and its matching badge always agree. Verify each token exists in `globals.css` before assuming; if `bg-muted` needs a border partner for `neutral`, keep `border-border`.
- `role="status"` + `aria-live="polite"` is copied from the existing impersonation banner. Keep it.

- [ ] **Step 2: Rewrite the impersonation banner on top of it**

```tsx
// src/components/redesign/shell/RedesignImpersonationBanner.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShellBanner } from '@/components/ui/shell-banner';
import { useAuth } from '@/hooks/useAuth';

/**
 * Shown while a platform admin is "viewing as" a tenant. Exit clears
 * impersonation and returns to the redesign owner back-office. Renders nothing
 * when not impersonating. The legacy amber banner in LayoutWrapper suppresses
 * itself on the redesign roots so this is the only one on redesign routes.
 */
export function RedesignImpersonationBanner() {
  const { impersonatingOrgId, impersonatingOrgName, stopImpersonation } = useAuth();
  const router = useRouter();

  if (!impersonatingOrgId) return null;

  return (
    <ShellBanner
      tone="caution"
      icon={<Eye />}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            stopImpersonation();
            router.push('/owner');
          }}
        >
          <LogOut /> Exit
        </Button>
      }
    >
      Viewing as <strong>{impersonatingOrgName ?? 'tenant'}</strong> (read-only)
    </ShellBanner>
  );
}
```

- [ ] **Step 3: Verify nothing regressed**

Run: `npx tsc --noEmit && npx vitest run src/components`
Expected: PASS. The impersonation banner has no unit test today; the gate is that the type-check is clean and no other suite references its internal classes.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/shell-banner.tsx src/components/redesign/shell/RedesignImpersonationBanner.tsx
git commit -m "feat(ui): add ShellBanner primitive, adopt it in the impersonation banner"
```

---

### Task 3: `GET /api/billing/state` **[Opus]**

Nothing on the client can read billing state today. `AuthContext` loads org membership, not the billing columns, and PR D/E shipped only mutating routes (`checkout`, `plan`, `trial/extend`). This route is the single read.

It returns the RAW row and lets the client call `deriveBillingAccess` itself. That is deliberate: spec §7 requires exactly one definition of "frozen", and `src/lib/billing/access.ts` imports only from `./plans`, which has no imports at all, so both are client-safe. Do NOT re-derive state on the server and ship a computed verdict.

**Files:**
- Create: `src/app/api/billing/state/route.ts`
- Test: `src/app/api/billing/state/route.integration.test.ts`

**Interfaces:**
- Consumes: `requireOrgAuth` from `@/lib/auth/requireOrgAuth`; `ORG_BILLING_COLUMNS`, `OrgBillingRow` from `@/lib/billing/access`; `countSeatsInUse` from `@/lib/billing/seats`; `supabaseAdmin` from `@/lib/supabase-admin`
- Produces:
  ```ts
  // GET /api/billing/state?organization_id=<uuid>
  // 200 { success: true, data: BillingStatePayload }
  export interface BillingStatePayload {
    billing: OrgBillingRow
    seats_in_use: number
    role: 'owner' | 'admin' | 'manager'
    /** organizations.subscription_current_period_end. NOT part of OrgBillingRow:
     *  deriveBillingAccess does not need it, and widening ORG_BILLING_COLUMNS
     *  would ripple into every server guard call site for no reason. */
    current_period_end: string | null
  }
  ```

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/billing/state/route.integration.test.ts
import { describe, expect, it } from 'vitest';
import { GET } from './route';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();

/**
 * withTestOrg()'s `admin` handle is seeded as org role 'admin', not 'owner'.
 * Same helper as src/app/api/billing/trial/extend/route.integration.test.ts.
 */
async function setRole(organizationId: string, userId: string, role: string) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error) throw new Error(`set role failed: ${error.message}`);
}

function get(token: string, organizationId?: string) {
  const qs = organizationId ? `?organization_id=${organizationId}` : '';
  return callRoute(GET, {
    method: 'GET',
    url: `http://localhost/api/billing/state${qs}`,
    headers: bearerHeader(token),
  });
}

describe('GET /api/billing/state', () => {
  it('returns the raw billing row, seats in use and the caller role', async () => {
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      const res = await get(org.admin.accessToken, org.organizationId);

      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      // withTestOrg stamps a live 14-day trial (PR D changed the fixture default).
      const billing = body.data.billing as Record<string, unknown>;
      expect(billing.subscription_status).toBe('trialing');
      expect(billing.trial_ends_at).toEqual(expect.any(String));
      expect(body.data.role).toBe('owner');
      expect(typeof body.data.seats_in_use).toBe('number');
    } finally {
      await org.cleanup();
    }
  });

  it('returns every column deriveBillingAccess needs, plus the renewal date', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.admin.accessToken, org.organizationId);
      const data = (res.body as { data: Record<string, unknown> }).data;
      const billing = data.billing as Record<string, unknown>;

      for (const col of [
        'subscription_status', 'trial_ends_at', 'trial_extended_at', 'comped_at',
        'plan_tier', 'billing_period', 'seat_count', 'subscription_cancel_at',
        'billing_paused_at', 'billing_pause_resumes_at',
      ]) {
        expect(billing).toHaveProperty(col);
      }
      // Sits OUTSIDE `billing` on purpose: not in ORG_BILLING_COLUMNS, because
      // deriveBillingAccess never reads it. Task 9 renders it as "Renews on".
      expect(data).toHaveProperty('current_period_end');
    } finally {
      await org.cleanup();
    }
  });

  it('allows an admin and reports their role', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(200);
      expect((res.body as { data: { role: string } }).data.role).toBe('admin');
    } finally {
      await org.cleanup();
    }
  });

  it('allows a manager, because a frozen manager must learn why work is blocked', async () => {
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'manager');
      const res = await get(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(200);
      expect((res.body as { data: { role: string } }).data.role).toBe('manager');
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a cleaner', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.cleaner.accessToken, org.organizationId);
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a member of another org', async () => {
    const orgA = await withTestOrg();
    const orgB = await withTestOrg();
    try {
      const res = await get(orgB.admin.accessToken, orgA.organizationId);
      expect(res.status).toBe(403);
    } finally {
      await orgB.cleanup();
      await orgA.cleanup();
    }
  });

  it('400s without organization_id', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.admin.accessToken);
      expect(res.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });
});

```

**Revised 2026-09-22.** The first version of this test used a `withTestOrg(callback)` API that does not exist. The real shapes, verified in the helpers:

- `withTestOrg(opts?)` **returns** `TestOrgFixture` (`tests/helpers/fixtures.ts:118`); it is not callback-style. Always `await org.cleanup()` in a `finally`.
- `TestOrgFixture` exposes `organizationId`, `admin`, `cleaner`, `homeowner`. **There is no `owner` handle**: `admin` is seeded with org role `'admin'`, so promote it when you need an owner, exactly as `trial/extend/route.integration.test.ts` does.
- `callRoute(handler, { method, url?, body?, headers? })` returns `{ status, body, raw }` with **`body` already parsed**. Never call `res.json()`.
- Auth is `bearerHeader(token)` from `tests/helpers/auth.ts`, not an `actor:` field.
- `withTestOrg({ billing: { ... } })` overrides the billing columns; PR D added it, and every fixture org otherwise starts on a live 14-day trial.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:integration -- billing/state`
Expected: FAIL, cannot resolve `./route`

- [ ] **Step 3: Implement**

```ts
// src/app/api/billing/state/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth'
import { ORG_BILLING_COLUMNS, type OrgBillingRow } from '@/lib/billing/access'
import { countSeatsInUse } from '@/lib/billing/seats'

export const runtime = 'nodejs'

export interface BillingStatePayload {
  billing: OrgBillingRow
  seats_in_use: number
  role: 'owner' | 'admin' | 'manager'
  /**
   * organizations.subscription_current_period_end, used for the "Renews on"
   * line. Deliberately NOT folded into ORG_BILLING_COLUMNS: that constant is
   * the deriveBillingAccess contract, and widening it would ripple into every
   * server guard call site for a field the state machine never reads.
   */
  current_period_end: string | null
}

/**
 * The one client read of billing state. Returns the RAW columns so the client
 * can call deriveBillingAccess itself: spec §7 requires exactly one definition
 * of "frozen", and access.ts is client-safe (it imports only ./plans, which has
 * no imports). Never compute a verdict here.
 *
 * Deliberately NOT behind assertOrgWritable. Reading billing state is how a
 * frozen org learns it is frozen; guarding it would be circular.
 */
export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get('organization_id')
  if (!organizationId) {
    return NextResponse.json({ error: 'organization_id is required' }, { status: 400 })
  }

  // Operator-shell roles only. Cleaners and homeowners have their own shells and
  // never render billing chrome.
  const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
    allowedRoles: ['owner', 'admin', 'manager'],
  })
  if (!auth.ok) return auth.response

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select(`${ORG_BILLING_COLUMNS}, subscription_current_period_end`)
    .eq('id', organizationId)
    .single()

  if (error || !org) {
    return NextResponse.json({ error: 'Could not load billing state' }, { status: 500 })
  }

  const seatsInUse = await countSeatsInUse(supabaseAdmin, organizationId)

  const row = org as unknown as OrgBillingRow & { subscription_current_period_end: string | null }

  const payload: BillingStatePayload = {
    billing: row,
    seats_in_use: seatsInUse,
    role: auth.role as BillingStatePayload['role'],
    current_period_end: row.subscription_current_period_end ?? null,
  }

  return NextResponse.json({ success: true, data: payload })
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:integration -- billing/state`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/api/billing/state
git commit -m "feat(billing): add GET /api/billing/state for the client"
```

---

### Task 4: `POST /api/billing/plan/preview` **[Opus]**

This is the task that makes an honest confirm step possible. Today `POST /api/billing/plan` applies a change and returns only `{ tier, period, seat_count }`, so a mid-cycle upgrade tells the customer nothing about what they are charged. Ruling **R8**: the previewed total must include tax when the tax flag is on, because a $99.00 in-app summary followed by a $107.17 Stripe page is the exact surprise that cost StubHub 44.58% at the purchase step.

**Verified against the pinned SDK** (`stripe@20.1.2`): `stripe.invoices.createPreview()` exists (`node_modules/stripe/types/InvoicesResource.d.ts:4034`) and `InvoiceCreatePreviewParams` accepts `automatic_tax`, `subscription`, and `subscription_details`. Do not use `retrieveUpcoming`, which is not present.

**This route must never mutate.** It is a read that happens to be a POST because it carries a selection body.

**Files:**
- Create: `src/app/api/billing/plan/preview/route.ts`
- Test: `src/app/api/billing/plan/preview/route.integration.test.ts`
- Modify: `src/lib/stripe/billing.ts` (add one wrapper, see Step 3)

**Interfaces:**
- Consumes: `parsePlanSelection`, `seatBoundsError`, `seatsInUseError` from `@/lib/billing/planSelection`; `readLiveSubscription` from `@/lib/payments/orgBilling`; `resolvePrices`, `retrieveSubscription` from `@/lib/stripe/billing`; `diffSubscriptionItems` from `@/lib/billing/diffSubscriptionItems`; `billingTaxEnabled` from `@/lib/billing/flags`
- Produces:
  ```ts
  export interface PlanPreviewPayload {
    /** Amount actually charged now, in cents, tax included when the tax flag is on. */
    due_now_cents: number
    /** Recurring amount per period after this change, tax included when on. */
    recurring_cents: number
    /** ISO date the next invoice falls due, or null if Stripe did not supply one. */
    next_charge_at: string | null
    /** Cents of tax inside due_now_cents. 0 when the tax flag is off. */
    tax_cents: number
    /** True when the tax flag is off, so the UI can say tax is not included. */
    tax_excluded: boolean
    /** True when there is no live subscription, so this is a first purchase via Checkout. */
    is_new_subscription: boolean
  }
  ```

- [ ] **Step 1: Add the Stripe wrapper**

Append to `src/lib/stripe/billing.ts`, next to `retrieveSubscription` and `updateSubscriptionItems`, following the existing wrapper style in that file:

```ts
/**
 * Preview what a subscription change costs WITHOUT applying it. Read-only.
 *
 * Mirrors the item diff updateSubscriptionItems would send, so the number the
 * customer sees is the number they are charged. automatic_tax is passed on
 * exactly the same condition as the real Checkout Session, otherwise the preview
 * and the charge disagree (ruling R8).
 *
 * `customer` is deliberately NOT passed: InvoiceCreatePreviewParams marks it
 * optional, and `subscription` already identifies the customer. An earlier draft
 * of this plan read it off readLiveSubscription, which does not return it.
 */
export async function previewSubscriptionChange(input: {
  subscriptionId: string;
  items: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[];
}): Promise<Stripe.Invoice> {
  const params: Stripe.InvoiceCreatePreviewParams = {
    subscription: input.subscriptionId,
    subscription_details: {
      items: input.items,
      proration_behavior: 'create_prorations',
    },
  };
  if (billingTaxEnabled()) {
    params.automatic_tax = { enabled: true };
  }
  return getStripe().invoices.createPreview(params);
}
```

Implementer note: `billingTaxEnabled` may already be imported in that file for `createBillingCheckoutSession`. Reuse the existing import rather than adding a second.

- [ ] **Step 2: Write the failing integration test**

The Stripe layer is mocked, as in every other PR E route test. Copy the `vi.mock('@/lib/stripe/billing', ...)` shape from `src/app/api/billing/plan/route.integration.test.ts` so the mock surface stays consistent.

```ts
// src/app/api/billing/plan/preview/route.integration.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock surface copied from src/app/api/billing/plan/route.integration.test.ts.
// resolvePrices returns Record<LookupKey, string>, i.e. plain price ids, and the
// seat keys are extra_seat_monthly / extra_seat_annual.
const previewSubscriptionChange = vi.fn();
const retrieveSubscription = vi.fn();

vi.mock('@/lib/stripe/billing', () => ({
  previewSubscriptionChange: (...a: unknown[]) => previewSubscriptionChange(...a),
  retrieveSubscription: (...a: unknown[]) => retrieveSubscription(...a),
  resolvePrices: vi.fn(async () => ({
    starter_monthly: 'p_sm', starter_annual: 'p_sa',
    growth_monthly: 'p_gm', growth_annual: 'p_ga',
    pro_monthly: 'p_pm', pro_annual: 'p_pa',
    extra_seat_monthly: 'p_esm', extra_seat_annual: 'p_esa',
  })),
}));

import { POST } from './route';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();

async function setRole(organizationId: string, userId: string, role: string) {
  const { error } = await supabase
    .from('organization_members').update({ role })
    .eq('organization_id', organizationId).eq('user_id', userId);
  if (error) throw new Error(`set role failed: ${error.message}`);
}

async function readBilling(organizationId: string) {
  const { data } = await supabase
    .from('organizations')
    .select('plan_tier, billing_period, seat_count')
    .eq('id', organizationId).single();
  return data as { plan_tier: string | null; billing_period: string | null; seat_count: number | null };
}

function preview(token: string, organizationId: string, body: Record<string, unknown>) {
  return callRoute(POST, {
    method: 'POST',
    headers: bearerHeader(token),
    body: { organization_id: organizationId, ...body },
  });
}

/** A live Growth-monthly subscription on 8 seats. */
const LIVE_BILLING = {
  subscription_status: 'active',
  subscription_id: 'sub_live',
  stripe_customer_id: 'cus_1',
  plan_tier: 'growth',
  billing_period: 'monthly',
  seat_count: 8,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/billing/plan/preview', () => {
  it('returns the tax-inclusive amount due now for an upgrade', async () => {
    vi.stubEnv('BILLING_TAX_ENABLED', 'true');
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      retrieveSubscription.mockResolvedValue({
        id: 'sub_live',
        items: { data: [{ id: 'si_base', quantity: 1, price: { lookup_key: 'growth_monthly' } }] },
      });
      previewSubscriptionChange.mockResolvedValue({
        amount_due: 10717, total: 10717,
        total_taxes: [{ amount: 817 }],
        next_payment_attempt: 1792000000,
      });

      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'pro', period: 'monthly', seat_count: 15 });

      expect(res.status).toBe(200);
      const { data } = res.body as { data: Record<string, unknown> };
      expect(data.due_now_cents).toBe(10717);
      expect(data.tax_cents).toBe(817);
      expect(data.tax_excluded).toBe(false);
      expect(data.is_new_subscription).toBe(false);
      expect(data.direction).toBe('upgrade');
    } finally {
      await org.cleanup();
    }
  });

  it('reports a downgrade as credited to the next invoice, not charged today', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      retrieveSubscription.mockResolvedValue({
        id: 'sub_live',
        items: { data: [{ id: 'si_base', quantity: 1, price: { lookup_key: 'growth_monthly' } }] },
      });
      previewSubscriptionChange.mockResolvedValue({ amount_due: 0, total: 0, total_taxes: [] });

      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'starter', period: 'monthly', seat_count: 3 });

      const { data } = res.body as { data: Record<string, unknown> };
      expect(data.direction).toBe('downgrade');
      // Ruling R21: a downgrade is never worded as a charge.
      expect(data.due_now_cents).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  it('never mutates the org row', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      retrieveSubscription.mockResolvedValue({
        id: 'sub_live',
        items: { data: [{ id: 'si_base', quantity: 1, price: { lookup_key: 'growth_monthly' } }] },
      });
      previewSubscriptionChange.mockResolvedValue({ amount_due: 6000, total: 6000, total_taxes: [] });

      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'pro', period: 'monthly', seat_count: 15 });
      expect(res.status).toBe(200);

      const after = await readBilling(org.organizationId);
      expect(after.plan_tier).toBe('growth');
      expect(after.seat_count).toBe(8);
    } finally {
      await org.cleanup();
    }
  });

  it('prices a first purchase from the catalogue without calling Stripe', async () => {
    // Fixture default: live trial, no subscription_id.
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'growth', period: 'monthly', seat_count: 8 });

      expect(res.status).toBe(200);
      const { data } = res.body as { data: Record<string, unknown> };
      expect(data.is_new_subscription).toBe(true);
      expect(data.due_now_cents).toBe(9900);
      expect(previewSubscriptionChange).not.toHaveBeenCalled();
    } finally {
      await org.cleanup();
    }
  });

  it('marks tax excluded when the tax flag is off', async () => {
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'growth', period: 'monthly', seat_count: 8 });
      const { data } = res.body as { data: Record<string, unknown> };
      expect(data.tax_excluded).toBe(true);
      expect(data.tax_cents).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a seat count below the tier floor', async () => {
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      // Growth includes 8; 2 is below the floor. (The earlier draft sent 99,
      // which is ABOVE Growth's max of 15 and tested a different rule.)
      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'growth', period: 'monthly', seat_count: 2 });
      expect(res.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a seat count above the tier maximum', async () => {
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'starter', period: 'monthly', seat_count: 99 });
      expect(res.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it('refuses while past_due, matching POST /api/billing/plan', async () => {
    const org = await withTestOrg({ billing: { ...LIVE_BILLING, subscription_status: 'past_due' } });
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'pro', period: 'monthly', seat_count: 15 });
      expect(res.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a non-owner', async () => {
    const org = await withTestOrg({ billing: LIVE_BILLING });
    try {
      const res = await preview(org.admin.accessToken, org.organizationId,
        { tier: 'pro', period: 'monthly', seat_count: 15 });
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });
});

```

**Revised 2026-09-22.** Use the same real fixture API described in Task 3: `withTestOrg({ billing: {...} })` returns a fixture, `admin` is an admin until promoted, `callRoute` returns a parsed `body`, and auth goes through `bearerHeader`. Read `src/app/api/billing/plan/route.integration.test.ts` for the Stripe-mocked variant of this shape, which is the closest sibling to what you are writing.

- [ ] **Step 3: Run the test and verify it fails**

Run: `npm run test:integration -- plan/preview`
Expected: FAIL, cannot resolve `./route`

- [ ] **Step 4: Implement**

```ts
// src/app/api/billing/plan/preview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { parsePlanSelection, seatBoundsError } from '@/lib/billing/planSelection';
import { readLiveSubscription } from '@/lib/payments/orgBilling';
import { previewSubscriptionChange, retrieveSubscription, resolvePrices } from '@/lib/stripe/billing';
import { diffSubscriptionItems } from '@/lib/billing/diffSubscriptionItems';
import { readCurrentItems } from '@/lib/billing/readCurrentItems';
import { shouldInvoiceNow } from '@/lib/billing/planDirection';
import { planChargeCents } from '@/lib/billing/plans';
import { billingTaxEnabled } from '@/lib/billing/flags';

export const runtime = 'nodejs';

export interface PlanPreviewPayload {
  /** Charged now, in cents, tax included when the tax flag is on. 0 for a downgrade. */
  due_now_cents: number;
  /** Recurring amount per period after this change. */
  recurring_cents: number;
  /** ISO date of the next invoice, or null when Stripe did not supply one. */
  next_charge_at: string | null;
  tax_cents: number;
  /** True when the tax flag is off, so the UI says tax is calculated at checkout. */
  tax_excluded: boolean;
  is_new_subscription: boolean;
  /** Drives the copy (ruling R21). An upgrade is charged now; a downgrade is credited. */
  direction: 'upgrade' | 'downgrade' | 'unchanged';
}

/**
 * Price a plan change WITHOUT applying it, so the confirm step can state the
 * exact amount (rulings R7, R8, R21, and ROSCA pre-charge disclosure).
 *
 * READ ONLY. Never writes to Stripe or to organizations. POST only because it
 * carries a selection body.
 *
 * Owner only, and refused while past_due or unpaid, both matching
 * POST /api/billing/plan exactly. If the two ever disagree, the preview quotes a
 * change the apply call would reject.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const organizationId = body?.organization_id;
    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    const parsed = parsePlanSelection(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner'],
    });
    if (!auth.ok) return auth.response;

    const { tier, period, seatCount } = parsed.selection;
    const boundsError = seatBoundsError(tier, seatCount);
    if (boundsError) return NextResponse.json({ error: boundsError }, { status: 400 });

    // Same columns and same refusal as POST /api/billing/plan.
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('plan_tier, billing_period, seat_count, subscription_status')
      .eq('id', organizationId)
      .single();

    const status = org?.subscription_status as string | undefined;
    if (status === 'past_due' || status === 'unpaid') {
      return NextResponse.json(
        {
          error: 'billing_payment_required',
          message: 'Please update your payment method before changing your plan.',
          state: status,
        },
        { status: 409 },
      );
    }

    const stored = {
      planTier: org?.plan_tier ?? null,
      billingPeriod: org?.billing_period ?? null,
      seatCount: org?.seat_count ?? null,
    };
    const target = { tier, period, seatCount };
    const invoiceNow = shouldInvoiceNow(stored, target);
    const direction: PlanPreviewPayload['direction'] = directionOf(stored, target);

    const taxOn = billingTaxEnabled();
    const live = await readLiveSubscription(supabaseAdmin, organizationId);

    // First purchase: nothing to prorate. Price from the catalogue; Stripe computes
    // real tax on the hosted Checkout page.
    if (!live.hasLiveSub) {
      const charge = planChargeCents(tier, period, seatCount);
      return NextResponse.json({
        success: true,
        data: {
          due_now_cents: charge,
          recurring_cents: charge,
          next_charge_at: null,
          tax_cents: 0,
          tax_excluded: true,
          is_new_subscription: true,
          direction: 'upgrade',
        } satisfies PlanPreviewPayload,
      });
    }

    const sub = await retrieveSubscription(live.subscriptionId!);
    const prices = await resolvePrices();
    const current = readCurrentItems(sub);
    const items = diffSubscriptionItems(current, target, prices);

    const invoice = await previewSubscriptionChange({
      subscriptionId: live.subscriptionId!,
      items: items as unknown as Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[],
    });

    const taxCents = taxOn ? sumTax(invoice) : 0;

    return NextResponse.json({
      success: true,
      data: {
        // SUPERSEDED by ruling R21 v2: shipped code quotes
        // summarizePreviewInvoice(invoice, prorationDate).dueNowCents for EVERY
        // direction. Forcing a non-upgrade to zero is the bug v2 removed.
        due_now_cents: invoiceNow ? (invoice.amount_due ?? 0) : 0,
        recurring_cents: planChargeCents(tier, period, seatCount) + taxCents,
        next_charge_at: invoice.next_payment_attempt
          ? new Date(invoice.next_payment_attempt * 1000).toISOString()
          : null,
        tax_cents: taxCents,
        tax_excluded: !taxOn,
        is_new_subscription: false,
        direction,
      } satisfies PlanPreviewPayload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not price this change';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Total tax across whatever shape the pinned API version returns. */
function sumTax(invoice: Stripe.Invoice): number {
  const taxes = (invoice as unknown as { total_taxes?: { amount: number }[] }).total_taxes;
  return Array.isArray(taxes) ? taxes.reduce((sum, t) => sum + (t.amount ?? 0), 0) : 0;
}
```

**Revised 2026-09-22, after the PR E fix pass landed.** Two prerequisites now exist or must be created:

- **`readCurrentItems` is already shared.** PR E's fix pass extracted it to `src/lib/billing/readCurrentItems.ts` and both `plan/route.ts` and the webhook classifier now use it, so a Price whose lookup key was transferred away still classifies. Import it; do NOT write a second copy, and do NOT reintroduce the `readCurrentItemsForPreview` name the earlier draft invented.
- **`shouldInvoiceNow` must be extracted.** PR E's fix put it inside `src/app/api/billing/plan/route.ts` as a private function. Move it to `src/lib/billing/planDirection.ts`, export it alongside a new `directionOf(stored, target): 'upgrade' | 'downgrade' | 'unchanged'` built from the same `planChargeCents` comparison, and import both in `plan/route.ts` and in this route. Keep `plan/route.ts`'s behaviour byte-identical; this is a move, not a rewrite. Ruling **R23**: two copies of "is this an upgrade" that can drift is exactly how the preview comes to quote a number the apply call does not honour.

`directionOf` returns `'upgrade'` whenever `shouldInvoiceNow` is true, `'unchanged'` when the per-cycle charge is identical, and `'downgrade'` otherwise. It exists separately because the UI needs three words where the Stripe call needs one boolean.

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm run test:integration -- plan/preview && npm run test:integration -- billing/plan`
Expected: PASS. The second command guards the refactor in the implementer note.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/billing/plan/preview src/lib/stripe/billing.ts src/lib/billing/diffSubscriptionItems.ts src/app/api/billing/plan/route.ts
git commit -m "feat(billing): add a read-only proration preview endpoint"
```

---

### Task 5: Client data layer (`format.ts`, `billing-api.ts`, `useBilling`) **[Sonnet]**

One hook every billing surface reads from. Nothing below this task talks to `fetch` directly.

**Files:**
- Create: `src/lib/billing/format.ts`, `src/lib/billing/format.test.ts`
- Create: `src/components/redesign/billing/billing-api.ts`
- Create: `src/hooks/useBilling.ts`
- Modify: `src/lib/queryKeys.ts` (add `billing.preview`)

**Interfaces:**
- Consumes: `deriveBillingAccess`, `OrgBillingRow`, `BillingAccess` from `@/lib/billing/access`; `BillingStatePayload` from Task 3; `PlanPreviewPayload` from Task 4; `useOrgQuery` from `@/lib/useOrgQuery`
- Produces:
  ```ts
  // format.ts
  export function formatCents(cents: number): string           // 10717 -> "$107.17"
  export function formatBillingDate(iso: string | null): string // -> "October 21, 2026", "" when null

  // billing-api.ts
  export function fetchBillingState(orgId: string): Promise<BillingStatePayload>
  export function previewPlan(orgId: string, sel: PlanSelectionBody): Promise<PlanPreviewPayload>
  export function changePlan(orgId: string, sel: PlanSelectionBody): Promise<{ checkout_url?: string }>
  export function startCheckout(orgId: string, sel: PlanSelectionBody): Promise<{ checkout_url: string }>
  export function extendTrial(orgId: string): Promise<void>
  export interface PlanSelectionBody { tier: PlanTier; period: BillingPeriod; seat_count: number }

  // useBilling.ts
  export interface UseBillingResult {
    access: BillingAccess | null
    billing: OrgBillingRow | null
    seatsInUse: number
    role: 'owner' | 'admin' | 'manager' | null
    /** ISO renewal date, or null on a trial. Sibling of `billing`, not inside it. */
    currentPeriodEnd: string | null
    isOwner: boolean
    canSeeBillingChrome: boolean   // owner or admin (R15)
    uiEnabled: boolean             // billingEnforcementUiEnabled()
    isLoading: boolean
  }
  export function useBilling(): UseBillingResult
  ```

- [ ] **Step 1: Write the failing format test**

```ts
// src/lib/billing/format.test.ts
import { describe, it, expect } from 'vitest'
import { formatCents, formatBillingDate } from './format'

describe('formatCents', () => {
  it('formats whole dollars', () => { expect(formatCents(9900)).toBe('$99.00') })
  it('formats cents', () => { expect(formatCents(10717)).toBe('$107.17') })
  it('formats zero', () => { expect(formatCents(0)).toBe('$0.00') })
  it('formats a credit as negative', () => { expect(formatCents(-2500)).toBe('-$25.00') })
  it('groups thousands', () => { expect(formatCents(194800)).toBe('$1,948.00') })
})

describe('formatBillingDate', () => {
  it('formats an ISO date in long form', () => {
    expect(formatBillingDate('2026-10-21T00:00:00.000Z')).toBe('October 21, 2026')
  })
  it('returns an empty string for null', () => { expect(formatBillingDate(null)).toBe('') })
  it('returns an empty string for an unparseable value', () => { expect(formatBillingDate('nope')).toBe('') })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/lib/billing/format.test.ts`
Expected: FAIL, cannot resolve `./format`

- [ ] **Step 3: Implement `format.ts`**

```ts
// src/lib/billing/format.ts
// Display formatting only. Every amount in this system is integer cents;
// nothing here is used for arithmetic.

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})

/** 10717 -> "$107.17". Negative amounts render as "-$25.00". */
export function formatCents(cents: number): string {
  return MONEY.format(cents / 100)
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** ISO -> "October 21, 2026". Empty string when absent or unparseable. */
export function formatBillingDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return DATE.format(d)
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run src/lib/billing/format.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Add the query key**

In `src/lib/queryKeys.ts`, extend the existing `billing` namespace (currently `all` and `org`) so the preview is cacheable per selection:

```ts
  billing: {
    all: ['billing'] as const,
    org: (orgId: string) => ['billing', 'org', orgId] as const,
    preview: (orgId: string, tier: string, period: string, seats: number) =>
      ['billing', 'preview', orgId, tier, period, seats] as const,
  },
```

- [ ] **Step 6: Implement `billing-api.ts`**

```ts
// src/components/redesign/billing/billing-api.ts
import { getAccessToken } from '@/lib/auth/clientAccessToken'
import type { BillingPeriod, PlanTier } from '@/lib/billing/plans'
import type { BillingStatePayload } from '@/app/api/billing/state/route'
import type { PlanPreviewPayload } from '@/app/api/billing/plan/preview/route'

export interface PlanSelectionBody {
  tier: PlanTier
  period: BillingPeriod
  seat_count: number
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; data?: T }
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.')
  return json.data as T
}

export function fetchBillingState(orgId: string): Promise<BillingStatePayload> {
  return call<BillingStatePayload>(
    `/api/billing/state?organization_id=${encodeURIComponent(orgId)}`,
    { method: 'GET' },
  )
}

export function previewPlan(orgId: string, sel: PlanSelectionBody): Promise<PlanPreviewPayload> {
  return call<PlanPreviewPayload>('/api/billing/plan/preview', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId, ...sel }),
  })
}

/** Applies a change on a live subscription, or returns a checkout_url when there is none. */
export function changePlan(orgId: string, sel: PlanSelectionBody): Promise<{ checkout_url?: string }> {
  return call<{ checkout_url?: string }>('/api/billing/plan', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId, ...sel }),
  })
}

/** First purchase. Always returns a hosted Stripe Checkout URL (ruling R10). */
export function startCheckout(orgId: string, sel: PlanSelectionBody): Promise<{ checkout_url: string }> {
  return call<{ checkout_url: string }>('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId, ...sel }),
  })
}

/**
 * Stripe Customer Portal. NOTE the shape, verified 2026-09-22: the route is a
 * GET, takes return_url, and returns `{ success, url }` with NO `data` envelope,
 * unlike every other billing route. Do not route it through `call`, which would
 * return undefined.
 */
export async function getPortalUrl(orgId: string, returnUrl: string): Promise<string> {
  const token = await getAccessToken()
  const qs = new URLSearchParams({ organization_id: orgId, return_url: returnUrl })
  const res = await fetch(`/api/stripe/billing/portal-link?${qs}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string }
  if (!res.ok || !json.url) throw new Error(json.error || 'Could not open the billing portal.')
  return json.url
}

export async function extendTrial(orgId: string): Promise<void> {
  await call<unknown>('/api/billing/trial/extend', {
    method: 'POST',
    body: JSON.stringify({ organization_id: orgId }),
  })
}
```

Implementer note: confirm the exact response envelope of the three PR E routes before finalising (`checkout`, `plan`, `trial/extend`). They return `{ success: true, data: ... }`; if any differs, adapt `call` rather than special-casing at each call site.

- [ ] **Step 7: Implement `useBilling`**

```ts
// src/hooks/useBilling.ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { keys } from '@/lib/queryKeys'
import { deriveBillingAccess, type BillingAccess, type OrgBillingRow } from '@/lib/billing/access'
import { billingEnforcementUiEnabled } from '@/lib/billing/flags'
import { fetchBillingState } from '@/components/redesign/billing/billing-api'

export interface UseBillingResult {
  access: BillingAccess | null
  billing: OrgBillingRow | null
  seatsInUse: number
  role: 'owner' | 'admin' | 'manager' | null
  /** ISO renewal date, or null on a trial. Not part of OrgBillingRow. */
  currentPeriodEnd: string | null
  isOwner: boolean
  /** Owner or admin. Managers never see the pill or the pay CTAs (ruling R15/R2). */
  canSeeBillingChrome: boolean
  uiEnabled: boolean
  isLoading: boolean
}

/**
 * The one client read of billing state.
 *
 * refetchOnWindowFocus is turned ON here and ONLY here (ruling R19). The global
 * default in src/lib/queryClient.ts is false by design, but a past_due banner
 * that does not self-heal sits on the customer's screen after they have already
 * paid in the Stripe portal tab. GitHub's equivalent banner famously persisted
 * for over a month. Do not change the global default to fix this.
 */
export function useBilling(): UseBillingResult {
  const { currentOrganizationId, accessToken } = useAuth()
  const uiEnabled = billingEnforcementUiEnabled()

  const enabled = Boolean(currentOrganizationId && accessToken && uiEnabled)

  const { data, isLoading } = useQuery({
    queryKey: currentOrganizationId ? keys.billing.org(currentOrganizationId) : keys.billing.all,
    queryFn: () => fetchBillingState(currentOrganizationId as string),
    enabled,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const billing = data?.billing ?? null
  const role = data?.role ?? null

  return {
    access: billing ? deriveBillingAccess(billing, new Date()) : null,
    billing,
    seatsInUse: data?.seats_in_use ?? 0,
    role,
    currentPeriodEnd: data?.current_period_end ?? null,
    isOwner: role === 'owner',
    canSeeBillingChrome: role === 'owner' || role === 'admin',
    uiEnabled,
    isLoading,
  }
}
```

Implementer notes:
- This uses `useQuery` directly rather than `useOrgQuery` because it needs the local `refetchOnWindowFocus` override. Check `src/lib/useOrgQuery.ts` first: if it forwards arbitrary options through, prefer it for consistency with the rest of the codebase.
- A 403 (a cleaner, somehow on this shell) must not throw a visible error. The default retry policy already skips retry on 4xx; make sure the consumers treat `access === null` as "render nothing".

- [ ] **Step 8: Type-check and commit**

Run: `npx tsc --noEmit && npx vitest run src/lib/billing`

```bash
git add src/lib/billing/format.ts src/lib/billing/format.test.ts src/lib/queryKeys.ts \
        src/components/redesign/billing/billing-api.ts src/hooks/useBilling.ts
git commit -m "feat(billing): add the client data layer for billing UI"
```

---

### Task 6: `PlanPicker` **[Opus]**

The money component. Built once, mounted twice (paywall and Settings, ruling R3). Owns tier selection, the period toggle, the seat stepper, and the live summary rail.

**Files:**
- Create: `src/components/redesign/billing/PlanPicker.tsx`
- Create: `src/components/redesign/billing/planPickerModel.ts`
- Test: `src/components/redesign/billing/planPickerModel.test.ts`

The pure decision logic lives in `planPickerModel.ts` so it can be unit-tested without rendering. The component is a thin renderer over it.

**Interfaces:**
- Consumes: `PLANS`, `PLAN_TIERS`, `seatBounds`, `planChargeCents`, `tierFor`, `EXTRA_SEAT_MONTHLY_CENTS`, `EXTRA_SEAT_ANNUAL_CENTS` from `@/lib/billing/plans`; `Stepper` (Task 1); `SegmentedControl`, `Button`, `Card` from `@/components/ui/*`; `previewPlan` (Task 5); `formatCents`, `formatBillingDate` (Task 5)
- Produces:
  ```ts
  // planPickerModel.ts
  export interface TierOption {
    tier: PlanTier
    name: string
    priceCents: number          // per month at the selected period
    includedSeats: number
    maxSeats: number | null
    available: boolean
    /** Set when available === false. Shown inline (ruling R6). */
    unavailableReason?: string
    /** Set on the pre-selected tier (ruling R5). Factual, never promotional. */
    fitReason?: string
  }
  export function buildTierOptions(args: {
    period: BillingPeriod; seatsInUse: number; currentTier: PlanTier | null
  }): TierOption[]
  export function defaultTierFor(seatsInUse: number, currentTier: PlanTier | null): PlanTier
  export function seatFloorFor(tier: PlanTier, seatsInUse: number): number

  // PlanPicker.tsx
  export interface PlanPickerProps {
    seatsInUse: number
    currentTier: PlanTier | null
    currentPeriod: BillingPeriod | null
    currentSeats: number | null
    orgId: string
    submitLabel: string                  // "Continue to payment" | "Update plan"
    onSubmit: (sel: PlanSelectionBody) => Promise<void>
    footer?: React.ReactNode             // escape hatch / extend link, supplied by the host
    /**
     * Invoked by the "See options" link on a tier the org is too big for (ruling R6).
     * The host decides what that means: Settings sends them to the Cleaners page to
     * deactivate someone; the paywall just selects the smallest tier that fits.
     * OMIT IT and the link is not rendered at all, rather than rendering dead.
     */
    onResolveTooSmall?: (tier: PlanTier) => void
  }
  export function PlanPicker(props: PlanPickerProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing model test**

```ts
// src/components/redesign/billing/planPickerModel.test.ts
import { describe, it, expect } from 'vitest'
import { buildTierOptions, defaultTierFor, seatFloorFor } from './planPickerModel'

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
          expect(o.unavailableReason ?? '').not.toContain('—')
          expect(o.fitReason ?? '').not.toContain('—')
        }
      }
    }
  })
})

describe('seatFloorFor', () => {
  it('floors at the greater of included seats and seats in use', () => {
    expect(seatFloorFor('growth', 3)).toBe(8)   // 8 included
    expect(seatFloorFor('growth', 11)).toBe(11) // headcount exceeds included
    expect(seatFloorFor('starter', 1)).toBe(3)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/components/redesign/billing/planPickerModel.test.ts`
Expected: FAIL, cannot resolve `./planPickerModel`

- [ ] **Step 3: Implement the model**

```ts
// src/components/redesign/billing/planPickerModel.ts
import {
  PLANS, PLAN_TIERS, type BillingPeriod, type PlanTier,
} from '@/lib/billing/plans'

export interface TierOption {
  tier: PlanTier
  name: string
  /** Per-month price at the selected period, in cents. */
  priceCents: number
  includedSeats: number
  maxSeats: number | null
  available: boolean
  /** Ruling R6: greyed tiers state WHY, inline. */
  unavailableReason?: string
  /** Ruling R5: factual, computed from their real headcount. Never promotional. */
  fitReason?: string
}

function cleaners(n: number): string {
  return n === 1 ? '1 cleaner' : `${n} cleaners`
}

/** The smallest tier whose max seats can hold the current headcount. */
export function defaultTierFor(seatsInUse: number, currentTier: PlanTier | null): PlanTier {
  const fits = (t: PlanTier) => {
    const max = PLANS[t].maxSeats
    return max === null || seatsInUse <= max
  }
  if (currentTier && fits(currentTier)) return currentTier
  return PLAN_TIERS.find(fits) ?? 'pro'
}

export function buildTierOptions(args: {
  period: BillingPeriod
  seatsInUse: number
  currentTier: PlanTier | null
}): TierOption[] {
  const { period, seatsInUse, currentTier } = args
  const preselected = defaultTierFor(seatsInUse, currentTier)

  return PLAN_TIERS.map((tier) => {
    const plan = PLANS[tier]
    const max = plan.maxSeats
    const available = max === null || seatsInUse <= max
    return {
      tier,
      name: plan.name,
      priceCents: period === 'annual' ? plan.annualMonthlyCents : plan.monthlyCents,
      includedSeats: plan.includedSeats,
      maxSeats: max,
      available,
      unavailableReason: available ? undefined : `Too small for your ${cleaners(seatsInUse)}`,
      fitReason: tier === preselected ? `Fits your ${cleaners(seatsInUse)}` : undefined,
    }
  })
}

/**
 * You may never buy fewer seats than you have people, and never fewer than the
 * tier includes (buying below the included count saves nothing).
 */
export function seatFloorFor(tier: PlanTier, seatsInUse: number): number {
  return Math.max(PLANS[tier].includedSeats, seatsInUse)
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run src/components/redesign/billing/planPickerModel.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Implement the component**

Build `PlanPicker.tsx` to this specification. Every visual comes from the design system; the companion mockups are structure reference only.

Layout:
- Two columns at `lg:` and above (`lg:grid-cols-[1.5fr_0.9fr]`), single column below. **Put `min-w-0` on both grid children**: without it this blows out horizontally on mobile (see memory `mobile-calendar-state`).
- Left column: `SegmentedControl` for the period, then the three tier cards in a `grid sm:grid-cols-3 gap-3`, then the seat row.
- Right column: the summary `Card`, sticky at `lg:sticky lg:top-20` (clears the `h-16` top bar).
- On mobile the summary becomes a sticky footer (`sticky bottom-0`) carrying the total and the submit button, so the CTA never falls below the fold.

Behaviour:
- Period state defaults to `currentPeriod ?? 'monthly'` (**ruling R4**: never default to annual).
- Tier state defaults to `defaultTierFor(seatsInUse, currentTier)`.
- Seat state defaults to `Math.max(seatFloorFor(tier, seatsInUse), currentSeats ?? 0)`.
- Changing tier re-clamps seats into `[seatFloorFor(tier, seatsInUse), PLANS[tier].maxSeats]`.
- An unavailable tier card is not clickable, is rendered with `aria-disabled="true"` and `opacity-60`, and shows `unavailableReason` in `text-caution-700`. It also renders a `Button variant="link" size="sm"` reading "See options" that calls `onResolveTooSmall(tier)`. **When that prop is absent, omit the link entirely** rather than rendering a control that does nothing.
- The selected tier card gets `border-primary ring-2 ring-primary/15`. **No ribbon, no badge** (ruling R5). The `fitReason` renders as small `text-primary` text inside the selected card.
- The seat row reads: `Stepper` plus helper text `"{seatsInUse} in use, {included} included at no extra cost"`.

Summary rail (**ruling R7**: itemise freely, but the total is always prominent):
- Line: `{Plan name}, {monthly|yearly}` and the base price.
- Line: `{n} seats, {included} included` and the extra-seat cost, or `$0.00`.
- Line, only when `preview.tax_excluded === false`: `Sales tax` and `formatCents(preview.tax_cents)`.
- Total line, visually dominant: the label from `totalRowFor` and `formatCents(preview.due_now_cents)`.
- Beneath: `Then {formatCents(recurring_cents)} on {formatBillingDate(next_charge_at)}.` plus `Cancel anytime.` **only when period === 'monthly'** (ruling R11).
- **The total line's LABEL is driven by the COMPUTED AMOUNT, never by `preview.direction`** (ruling R21 v2, and spec §10.4):

  | `due_now_cents` | Label | Amount |
  |---|---|---|
  | above zero | `Charged today` | `formatCents(due_now_cents)` |
  | zero | `Nothing is charged today` | `formatCents(0)` |

  `direction` still shapes the sentence UNDER the total: a downgrade that costs nothing today says `Nothing is charged today. Your plan changes to this price on {date}.`, and a downgrade that is billed today (the annual to monthly switch) says `Your unused time is credited against today's amount. Then {amount} on {date}.` It may never decide, or contradict, the headline figure. Saying "nothing is charged today" over a live charge is the surprise-at-checkout failure ruling R8 exists to prevent, pointed at ourselves.
- When `preview.tax_excluded === true`, add the line `Sales tax is calculated at checkout.` This is the honesty valve for R8 when the tax flag is off.

Preview wiring:
- `useQuery` keyed on `keys.billing.preview(orgId, tier, period, seats)` calling `previewPlan`. Debounce the seat stepper by 400ms so holding the plus button does not fire a request per click.
- While the preview is in flight, render the total as a `Skeleton` of the same height. **Never render a stale total next to a new selection** and never render an optimistic guess: a wrong number here is the exact failure R8 exists to prevent.
- If the preview request fails, disable the submit button and show `Could not price this change. Please try again.` Do not let them buy at an unknown price.

Submit:
- `Button` with `loading` while `onSubmit` runs. The `Button` primitive already renders a centred overlay spinner; do not prepend one beside the label (memory `submit-spinner-workstream`).

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npx vitest run src/components/redesign/billing && npm run lint`

Manual check at 375px width: no horizontal scroll, submit button reachable without scrolling past the fold.

```bash
git add src/components/redesign/billing/PlanPicker.tsx \
        src/components/redesign/billing/planPickerModel.ts \
        src/components/redesign/billing/planPickerModel.test.ts
git commit -m "feat(billing): add the shared PlanPicker with a live priced summary"
```

---

### Task 7: `BillingPaywall` and the shell mount **[Opus]**

The wall itself, plus the two shell edits that put it on screen. Owner only (**ruling R2**).

**Files:**
- Create: `src/components/redesign/billing/BillingPaywall.tsx`
- Create: `src/components/redesign/billing/usePaywall.ts`
- Modify: `src/components/redesign/shell/OperatorShell.tsx:124-128`

**Interfaces:**
- Consumes: `useBilling` (Task 5), `PlanPicker` (Task 6), `startCheckout`/`changePlan`/`extendTrial` (Task 5)
- Produces:
  ```ts
  // usePaywall.ts: lets any "new work" button open the wall (Tasks 8 and 12 consume this)
  //
  // ⚠ MODULE STORE, NOT A REACT CONTEXT. Task 12's 402 net lives in a plain async
  // function with no React tree, so it must be able to open the wall without a hook.
  // A context-based version cannot be called from there and will have to be rewritten.
  export function openPaywall(): void      // plain function, callable from anywhere
  export function closePaywall(): void     // plain function
  export function usePaywall(): { open: () => void; close: () => void; isOpen: boolean }
  // Built on useSyncExternalStore over the module-level state. No provider component.

  // BillingPaywall.tsx
  export function BillingPaywall({ children }: { children: React.ReactNode }): JSX.Element
  ```

`BillingPaywall` wraps the shell's content. It renders `children` (the real dashboard) whenever the wall should not show, so "View your data" is simply `close()`.

- [ ] **Step 1: Implement `usePaywall.ts`**

⚠ **Revised 2026-09-22.** Implement a **module-level store**, not a React context: module-scoped
state plus a `Set` of listeners, `openPaywall()` / `closePaywall()` exported as plain functions,
and `usePaywall()` built on `useSyncExternalStore`. Task 12 calls `openPaywall()` from
`billing-api.ts`, which is a plain module with no React tree, so a context cannot reach it.
There is no `PaywallProvider`; drop it from the shell mount in Step 3.

It must:
- default `isOpen` to `true` when `access.frozen === true` and the user is the owner and `uiEnabled`;
- default `isOpen` to `false` otherwise;
- re-open automatically whenever `access.frozen` flips from false to true (a trial expiring while the tab is open);
- **never** trap the user: `close()` must always work. This is the Asana failure mode (their "go back to free" escape silently disappeared, leaving a non-dismissible "Your trial has ended" modal over the customer's own data, and the complaint thread ran for years). There must be no code path where `isOpen` is true and `close` is unavailable.

- [ ] **Step 2: Implement `BillingPaywall.tsx`**

Render `children` untouched when any of these hold: `!uiEnabled`, `!access`, `!access.frozen`, `!isOwner`, or `!isOpen`.

Otherwise render a full-screen surface inside the shell content area (not a portal over the whole page, so the top bar and its banner stay visible and the user keeps their bearings):

```
<div className="min-h-[70vh] ...">
  headline by state
  reassurance row
  <PlanPicker ... footer={<escape hatch + extend>} />
</div>
```

Headline and subhead by `access.state`. Copy is fixed; use it verbatim. **No em dashes.**

| state | headline | subhead |
|---|---|---|
| `trial_expired` | `Your trial has ended` | `Your account is in view-only mode. Pick a plan to start booking again.` |
| `canceled` | `Your subscription has ended` | `Your account is in view-only mode. Choose a plan to start booking again.` |
| `unpaid` | `We could not process your payment` | `Your account is in view-only mode. Update your payment method or choose a plan to continue.` |
| `paused` | `Your account is paused` | `Paused until {formatBillingDate(billing.billing_pause_resumes_at)}. Contact us if you need to resume early.` |

`paused` renders **no** `PlanPicker` and no CTAs (spec §13). Just the message and the escape hatch.

Reassurance row, immediately under the subhead, in a `positive`-toned container:
`Your {n} jobs, {m} customers and all cleaner payout history are exactly where you left them.`

Source `n` and `m` from data already in the client cache if available; if either is not readily available without a new query, **drop the counts and use the generic sentence** `Your jobs, customers and cleaner payout history are exactly where you left them.` Do not add a query just to populate this line.

Footer passed into `PlanPicker`:
- `Button variant="outline"` reading `View your data`, calling `close()`. This is the escape hatch. It is a real button, not a text link, and it is never conditionally hidden.
- Below it, when `access.canExtendTrial`, a `Button variant="link" size="sm"` reading `Extend your trial by seven days` (wording taken from Squarespace's precedent). Secondary by construction (**ruling R12**), never styled as the primary action.

Submit handler: call `changePlan`. If the response carries `checkout_url`, `window.location.href = checkout_url` (hosted Checkout, **ruling R10**). Otherwise invalidate `keys.billing.all` and `close()`.

- [ ] **Step 3: Mount it in the shell**

In `src/components/redesign/shell/OperatorShell.tsx`, wrap the existing `<main>` content. The current shape is:

```tsx
<main id="main-content" className="mx-auto w-full max-w-[1700px] px-4 pb-28 pt-5 lg:px-6 lg:pb-10">
  ...
  {children}
```

Wrap `{children}` in `<BillingPaywall>{children}</BillingPaywall>`. **No provider is needed**: the store is module-level, so `OperatorTopBar` and every other consumer can call `usePaywall()` or `openPaywall()` without being inside a tree. Keep `<main>` and its classes exactly as they are; the paywall renders inside it.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run lint`

Manual: with `NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED` unset, the dashboard must be byte-identical to today. This is the flag-dark gate.

```bash
git add src/components/redesign/billing/BillingPaywall.tsx \
        src/components/redesign/billing/usePaywall.ts \
        src/components/redesign/shell/OperatorShell.tsx
git commit -m "feat(billing): add the owner paywall interstitial and mount it in the shell"
```

---

### Task 8: Trial pill, banners, and the view-only bar **[Sonnet]**

The three-step ladder (**ruling R13**), built on `ShellBanner` from Task 2.

**Files:**
- Create: `src/components/redesign/billing/BillingBanners.tsx`
- Create: `src/components/redesign/billing/TrialPill.tsx`
- Modify: `src/components/redesign/shell/OperatorShell.tsx:115`
- Modify: `src/components/redesign/shell/OperatorTopBar.tsx:76`

**Interfaces:**
- Consumes: `useBilling` (Task 5), `ShellBanner` (Task 2), `Badge`, `Button`
- Produces: `export function BillingBanners(): JSX.Element | null`, `export function TrialPill(): JSX.Element | null`

- [ ] **Step 1: Implement `TrialPill`**

Renders `null` unless `uiEnabled && canSeeBillingChrome && access?.state === 'trialing'`.

- `access.trialDaysLeft > 3`: `Badge variant="secondary"` reading `Trial, {n} days left`. Dismissible per session (**ruling R14**) via `sessionStorage` key `nexxus.trialPillDismissed`. Wrap the read and write in try/catch; a browser with storage blocked must still render the pill.
- `access.trialDaysLeft <= 3`: `Badge variant="caution"` reading `{n} days left`, **not** dismissible. Singular at 1: `1 day left`.
- `access.trialDaysLeft === 0`: render `null`; at zero the state is `trial_expired` and the frozen bar owns the message.

Mount in `OperatorTopBar.tsx` inside the right cluster at line 76, immediately before the New booking `Button` at line 80. It must be inside the `hidden sm:inline-flex` discipline the neighbouring controls use, so the mobile top bar does not overflow; if space is tight at 375px, the pill hides on mobile and the banner carries the message instead.

- [ ] **Step 2: Implement `BillingBanners`**

Renders at most ONE banner, chosen by this precedence. Returns `null` when `!uiEnabled` or `!access`.

1. **`past_due`, any role that can see chrome** (`canSeeBillingChrome`): `tone="critical"`, non-dismissible.
   Message: `We could not process your last payment. Update your payment method to keep your account active.`
   Action (owner only): `Button size="sm" variant="outline"` reading `Update payment method`, linking to the portal. Admin sees the message with no action.
2. **`frozen === true` and `isOwner`**: `tone="critical"`, non-dismissible. This is the view-only bar (option C, the one Bridger asked for).
   Message: `View-only mode. Your trial ended, so new bookings are paused. Scheduled jobs still run.`
   For `canceled`: `View-only mode. Your subscription ended, so new bookings are paused. Scheduled jobs still run.`
   For `paused`: `Your account is paused until {date}. New bookings are paused. Scheduled jobs still run.`
   Actions: `Extend seven days` (outline, only when `access.canExtendTrial`) and `Choose a plan` (default variant, calls `usePaywall().open()`). `paused` gets no actions.
3. **`frozen === true` and NOT owner** (**ruling R2**): `tone="neutral"`, non-dismissible, **no actions**.
   Message: `View-only mode. New bookings are paused until the account owner updates the plan. Scheduled jobs still run.`
4. **`trialing` and `trialDaysLeft <= 3` and `canSeeBillingChrome`**: `tone="caution"`, non-dismissible.
   At 3 and 2 days: `Your trial ends in {n} days. Choose a plan to keep booking jobs.`
   At 1 day: `Your trial ends tomorrow. After that your account becomes view-only and you cannot add new bookings.`
   Actions (owner only): `Extend seven days` (outline, when eligible), `Choose a plan` (default).
5. Otherwise `null`. Nothing renders during `active`, `comped`, or a trial with more than 3 days left (the pill covers that).

- [ ] **Step 3: Mount in the shell**

In `OperatorShell.tsx` at line 115, beside the existing banner:

```tsx
<RedesignImpersonationBanner />
<BillingBanners />
```

Order matters: impersonation first. A platform admin viewing as a tenant needs to know that before they read anything about billing.

**Fixed-element stacking check** (flagged by the `ui-ux-pro-max` design pass): these banners sit above a `sticky top-0 z-30` top bar, and the mobile shell also has a bottom nav. Verify at 375px that (a) both banners plus the top bar do not consume more than roughly a third of the viewport, (b) the sticky top bar still sticks correctly once the banners scroll away, and (c) nothing is hidden behind the bottom nav.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/components/redesign/billing/BillingBanners.tsx \
        src/components/redesign/billing/TrialPill.tsx \
        src/components/redesign/shell/OperatorShell.tsx \
        src/components/redesign/shell/OperatorTopBar.tsx
git commit -m "feat(billing): add the trial pill, banner ladder, and view-only bar"
```

---

### Task 9: Settings > Billing **[Opus]**

Eight state branches. A compact current-plan summary with a **Change plan** action that opens `PlanPicker` (**ruling R3**), not a permanent pricing table.

**Files:**
- Create: `src/components/redesign/settings/sections/BillingSection.tsx`
- Modify: `src/components/redesign/settings/sections.ts`
- Modify: `src/components/redesign/settings/sections/registry.ts`
- Test: `src/components/redesign/settings/sections.test.ts` (extend the existing file)

- [ ] **Step 1: Register the section**

In `sections.ts`: add `"billing"` to the `SettingsSectionId` union, and add to `REDESIGN_SETTINGS_SECTIONS`, placed directly after `payments`:

```ts
{ id: "billing", label: "Plan and billing", icon: CreditCard, group: "business", roles: ["owner", "admin"] },
```

`payments` already uses `CreditCard`; import a distinct icon for billing (`Receipt` is taken by `cancellation`, so use `Gem` or `BadgeDollarSign` from lucide) so the nav does not show two identical glyphs.

Roles are `["owner", "admin"]` per spec §13. Owner-only ACTIONS are disabled for admins inside the component; the section itself is visible to both, so an admin can still see the plan and reach invoices.

In `registry.ts`: import and add `billing: BillingSection`.

- [ ] **Step 2: Extend the existing sections test**

Add to `src/components/redesign/settings/sections.test.ts`:

```ts
it('shows billing to owner and admin but not manager or cleaner', () => {
  expect(deriveSettingsSections(undefined, 'owner').map((s) => s.id)).toContain('billing')
  expect(deriveSettingsSections(undefined, 'admin').map((s) => s.id)).toContain('billing')
  expect(deriveSettingsSections(undefined, 'manager', null).map((s) => s.id)).not.toContain('billing')
  expect(deriveSettingsSections(undefined, 'cleaner').map((s) => s.id)).not.toContain('billing')
})
```

Run: `npx vitest run src/components/redesign/settings/sections.test.ts`

⚠ **This task BREAKS two existing assertions** in that file (around lines 18-27), which compare the derived section list against an exact array. Adding `billing` makes both fail. Update those expected arrays in the same commit; do not delete the assertions, they are what stops a section leaking to the wrong role.

- [ ] **Step 3: Implement the eight branches**

Follow `src/components/redesign/settings/sections/PaymentsSection.tsx` for structure, spacing and heading conventions. Every branch renders inside the same section shell.

| `access.state` | Renders |
|---|---|
| `trialing` | `{n} days left in your trial`, `{seatsInUse} of 15 trial seats in use`, primary `Choose a plan` opening `PlanPicker`. `Extend your trial by seven days` as a secondary link when `canExtendTrial` |
| `trial_expired` | Same controls, heading `Your trial has ended`, `caution` tone. Not alarming, just definite |
| `active` | Plan card: tier badge, `formatCents(planChargeCents(...))` per period, `{seatsInUse} of {seat_count} seats in use`, `Renews on {formatBillingDate(currentPeriodEnd)}` (from `useBilling`, not from `billing.*`). When `subscription_cancel_at` is set, replace the renews line with `Cancels on {date}` in `caution` tone. Buttons: `Change plan` (opens `PlanPicker` with `submitLabel="Update plan"`), `Payment method and invoices` (portal) |
| `past_due` | Everything `active` shows, plus a `critical` inline notice at the top: `We could not process your last payment.` Primary action becomes `Update payment method` (portal); `Change plan` demotes to secondary |
| `unpaid` | Frozen plan card, `critical` tone. Primary `Reactivate` goes to the portal (the card needs fixing, not a new plan). **Ruling R22: build this branch, but do not spend design effort on it.** Spec §7.1 changed dunning to end by cancelling, so a lapsed customer lands in `canceled` instead. Any `unpaid` org in production means the Stripe Dashboard config has drifted |
| `canceled` | Frozen plan card. Primary `Choose a plan` opens `PlanPicker`, which will route to Checkout since there is no live subscription |
| `paused` | `Your account is paused until {formatBillingDate(billing_pause_resumes_at)}. Contact us to resume early.` **No controls at all** |
| `comped` | `Complimentary plan`, `{seatsInUse} seats in use`, no seat limit, **no controls** |

Admin gating: when `role === 'admin'`, every button that changes money (`Choose a plan`, `Change plan`, `Reactivate`, `Extend`) renders `disabled` with a `Tooltip` reading `Only the account owner can change the plan.` The portal link stays enabled for admins. Never hide the controls, disable them with a reason.

When `!uiEnabled`, the section renders a single line: `Billing is not enabled for this account yet.` It must not crash or render an empty card.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npx vitest run src/components/redesign/settings && npm run lint`

```bash
git add src/components/redesign/settings/sections.ts \
        src/components/redesign/settings/sections/registry.ts \
        src/components/redesign/settings/sections/BillingSection.tsx \
        src/components/redesign/settings/sections.test.ts
git commit -m "feat(billing): add the Settings Plan and billing section"
```

---

### Task 10: Seat indicator and the at-cap invite dialog **[Opus]**

The friction moment that matters most. Resolved inline, never by sending them to Billing (**ruling R16**).

**Files:**
- Create: `src/components/redesign/billing/SeatCapDialog.tsx`
- Modify: `src/components/redesign/cleaners/OperatorCleaners.tsx`
- Modify: `src/hooks/useAdminData.ts` (**not** `useInvites.ts`, see below)

**Interfaces:**
- Consumes: `useBilling` (Task 5), `previewPlan`/`changePlan` (Task 5), `Dialog` from `@/components/ui/dialog`
- Produces:
  ```ts
  export interface SeatCapDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The person they were trying to invite, for the copy. */
    inviteeName: string | null
    /** Retried automatically after a seat is added. */
    onSeatAdded: () => void
  }
  export function SeatCapDialog(props: SeatCapDialogProps): JSX.Element
  ```

- [ ] **Step 1: Surface the 409 payload from the real send path**

⚠ **Revised 2026-09-22. The earlier draft named the wrong file.** `src/hooks/useInvites.ts` has no send mutation at all; it only handles `resend`. The send path is the plain exported async function **`inviteTeamMember` in `src/hooks/useAdminData.ts:2267`**, called from `src/components/redesign/cleaners/OperatorCleaners.tsx:365`. It currently discards the response status and the 409 body. The D/E ledger already recorded this; it was missed when the plan was written.

`POST /api/admin/send-invite` returns 409 with a seat-cap body when the org is at its cap (PR D, placed after request validation). Today the caller surfaces `result.error` straight into a toast, so an operator would read the raw string `seat_cap_reached`.

Change `inviteTeamMember` to return the status and the parsed body rather than collapsing them, then have `OperatorCleaners.tsx` open `SeatCapDialog` on a 409 with `error === 'seat_cap_reached'` instead of toasting. Every other error keeps its current toast. Read the actual 409 body from `src/app/api/admin/send-invite/route.ts` before writing this; do not assume field names.

- [ ] **Step 2: Add the seat indicator**

In `OperatorCleaners.tsx`, beside the Invite button, render when `uiEnabled && access && access.seatCap !== null`:

`{seatsInUse} of {seatCap} seats used`

Wording follows Airtable's precedent ("2 of 4 seats available"), inverted to used-of-total because our cap is a purchase, not an allowance. When pending invites exist, extend to `{active} active and {pending} pending of {seatCap} seats`, because our model reserves a seat on invite and a silent reservation is the ClickUp/Loom complaint pattern.

During a trial, show the 15-seat trial cap **only when it is reached** (spec §13). Below the cap, show nothing during a trial.

- [ ] **Step 3: Implement `SeatCapDialog`**

Two cases, decided by whether a seat can be added within the current tier.

**Case 0, the org is on a trial** (`plan_tier` is null, cap is the flat 15). There is no tier to add a seat to and nothing to charge. Title: `You have used all 15 trial seats`. Body: `Your trial includes 15 cleaner seats and all 15 are in use. Choose a plan to add more.` Buttons: `Not now` and `Choose a plan`, the latter opening the paywall. **Check this case FIRST**: both cases below dereference `PLANS[tier]`, which throws when `tier` is null.

**Case A, room in the tier** (`seat_count < PLANS[tier].maxSeats`), owner only:

Title: `Add a seat to invite {inviteeName}?`
Body: `All {seat_count} of your seats are in use. One more seat is ${EXTRA_SEAT_MONTHLY_CENTS/100} a month.`
Then an itemised block ending in a prominent total (**ruling R17**, and R7):
```
{Tier name}, {seat_count} seats        $99.00
1 extra seat                           $10.00
New monthly total                     $109.00
```
Source the total from `previewPlan(orgId, { tier, period, seat_count: seat_count + 1 })` so the number is Stripe's, not ours. While it loads, show a `Skeleton`, never a computed guess.
Then: `A prorated amount is charged today. {inviteeName} can start right away.`
Buttons: `Cancel` (outline) and `Add seat and invite` (default). On confirm: `changePlan` with `seat_count + 1`, invalidate `keys.billing.all`, then call `onSeatAdded()` which retries the invite.

**Case B, tier is full** (`seat_count === PLANS[tier].maxSeats`), owner only:

Title: `{Tier name} is full`
Body: `{Tier name} holds a maximum of {maxSeats} seats and all {maxSeats} are in use. {NextTier} covers up to {nextMax} cleaners.`
Show the next tier's price and the delta from today's. Buttons: `Not now` (outline), `Move to {NextTier}` (default). Use `nextTierFor(seatsInUse, currentTier)` from `src/lib/billing/seats.ts`. When `nextTierFor` returns nothing above the current tier (already on Pro, which has no seat maximum), Case B is unreachable; assert that and render Case A.

**Non-owner** (**ruling R16**): both cases collapse to a single non-actionable dialog.
Title: `No seats available`
Body: `All {seat_count} seats are in use. Ask your account owner to add a seat before inviting {inviteeName}.`
One button: `Close`. No pricing is shown to a non-owner.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/components/redesign/cleaners`

```bash
git add src/components/redesign/billing/SeatCapDialog.tsx \
        src/components/redesign/cleaners/OperatorCleaners.tsx src/hooks/useAdminData.ts
git commit -m "feat(billing): resolve the seat cap inline in the invite flow"
```

---

### Task 11: Checkout return states **[Sonnet]**

After hosted Checkout, Stripe returns the user to our `success_url` / `cancel_url`. The subscription mirror arrives by webhook, so the org row may lag the redirect by a few seconds.

**Files:**
- Create: `src/components/redesign/billing/CheckoutReturn.tsx`
- Modify: `src/components/redesign/settings/sections/BillingSection.tsx` (mount it)

⚠ **Revised 2026-09-22.** The earlier draft mounted this inside `BillingPaywall`, where it would never render for the most common case. Checkout returns to `${appUrl}/admin/settings?section=billing&checkout=success` (`src/lib/payments/orgBilling.ts:270-271`), i.e. **Settings > Billing**, and a trialing buyer who purchased before expiry is not frozen, so no paywall is mounted to host it.

- [ ] **Step 1: Implement**

Read the query string with `useSearchParams`.

`?checkout=success`: render a centred `Activating your plan` state with the `NexxusLoader`, and poll `keys.billing.org(orgId)` every 2 seconds for up to 30 seconds, stopping as soon as `access.frozen === false`. On success, clear the param and show a brief `You are all set` confirmation before revealing the dashboard.

After 30 seconds without a mirror, stop polling and render:
`Your payment went through. Your account is still updating, which can take a moment. Refresh in a minute or contact us if it persists.`
Do **not** show an error. The payment succeeded; only our mirror is late, and the nightly `reconcileBillingMirror` sweep is the backstop.

`?checkout=canceled`: clear the param and return silently to the plan form (spec §13). No toast, no message. They chose to back out.

Clear the param with `replaceSearchShallow` from `src/lib/shallowSearch.ts`, **never** `router.replace`. This is a hard repo rule (memory `shallow-search-nav-rule`): Next 16 no-ops same-path `router.replace` calls after a reload-with-params.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/components/redesign/billing/CheckoutReturn.tsx src/components/redesign/billing/BillingPaywall.tsx
git commit -m "feat(billing): handle the hosted Checkout return states"
```

---

### Task 12: Wire the new-work entry points and intercept 402s **[Sonnet]**

Spec §12. Two halves: buttons that should open the wall instead of a form, and a net that catches any 402 from a stale tab.

**Files:**
- Modify: `src/components/redesign/shell/OperatorTopBar.tsx:80` (New booking)
- Modify: the Services editor, Add customer, and Invite entry points
- Modify: `src/components/redesign/billing/billing-api.ts` (shared 402 handling)

⚠ **Revised 2026-09-22.** Two corrections before you start.

**The paywall opener cannot be a hook.** `usePaywall()` is a React hook, and Task 12's 402 net lives in `billing-api.ts`'s `call`, a plain async function with no React context. Change `usePaywall` (Task 7) to wrap a **module-level store** rather than a bare context: a module that holds the open/closed boolean, exposes `openPaywall()` / `closePaywall()` as plain functions, and a `usePaywall()` hook built on `useSyncExternalStore`. `call` then imports `openPaywall` directly. A window `CustomEvent` also works; pick one and use it in both places.

**There is already a shared fetch helper, at `src/lib/auth/apiFetch.ts`** (not `src/lib/apiFetch.ts`, which does not exist; the review misreported the path and it was checked). Read it before adding the 402 handling, and prefer extending it over duplicating its error semantics in `billing-api.ts`.

- [ ] **Step 1: Gate the four entry points**

For each of New booking (`OperatorTopBar.tsx:80`), the Services editor, Add customer, and Invite: when `uiEnabled && access?.frozen`, the click calls `usePaywall().open()` instead of opening the form.

The button stays **visible and rendered disabled-looking**, not removed. A button that vanishes teaches nothing; a disabled one with a bar above it explaining why teaches the whole story. For a non-owner the click is a no-op (there is no wall to open for them) and the neutral bar from Task 8 carries the explanation.

**Gate New booking at the host, not at the buttons.** There are eight separate triggers that all open the same sheet by setting `?newbooking=1`, hosted by `src/components/redesign/bookings/new-booking/OperatorBookingHost.tsx` (it reads `useDetailParam('newbooking')`). Gate inside that host: when `uiEnabled && access?.frozen`, it opens the paywall instead of the sheet and clears the param. One place, and no trigger can be missed.

Note also that the menu item is labelled **"New customer"**, not "Add customer". Locate the remaining entry points with:
```bash
grep -rn "newbooking\|New customer\|Invite" src/components/redesign --include=*.tsx | head -30
```

The buttons themselves stay visible and rendered in a disabled style, but must remain clickable so the click can open the wall. Use `aria-disabled` plus the muted styling rather than the `disabled` attribute, which would swallow the click and leave the user with a dead control and no explanation.

- [ ] **Step 2: Add the 402 net**

In `billing-api.ts`'s `call` helper, and in the equivalent helpers the other route clients use, detect `res.status === 402` with `error === 'billing_frozen'`. On that, invalidate `keys.billing.all` and open the paywall, instead of throwing a toast-able error.

This is the stale-tab case: someone left a tab open across the trial boundary, clicks Save, and the server refuses. They should land on the wall, not on a red toast reading `billing_frozen`.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:unit`

```bash
git commit -am "feat(billing): route frozen new-work clicks and stale 402s to the paywall"
```

---

### Task 13: Homeowner blocked message **[Sonnet]**

The innocent third party. **Ruling R18**: never 404, never mention billing, always give a route around the block.

**Files:**
- Create: a migration via `npx supabase migration new add_org_contact_phone` (NEVER hand-number)
- Modify: `src/types/index.ts` (`Organization` interface)
- Modify: the organization profile settings section and `updateOrgProfile`
- Modify: `src/components/redesign/homeowner/booking/BookingFlow.tsx` (the 402 surfaces at `:104-113` today, as a toast)
- Modify: the Add a home submit path

⚠ **Revised 2026-09-22.** Ruling R18 says the blocked homeowner gets the company's phone so they can book offline. **`organizations` has no phone column.** The `phone` at `src/types/index.ts:77` belongs to `UserProfile`, which is a named individual's personal number, and surfacing that to their customers without asking is not something to ship by default. Bridger approved adding a real column.

- [ ] **Step 0: Add the column and a way to fill it**

```bash
npx supabase migration new add_org_contact_phone
```

```sql
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS contact_phone text;

COMMENT ON COLUMN public.organizations.contact_phone IS
  'Public contact number shown to homeowners when online booking is unavailable. Optional.';
```

Idempotent, as every migration here must be. Then add `contact_phone` to the `Organization` interface, to the org profile settings form (it sits naturally beside the existing org fields, saved through `updateOrgProfile`), and label it so the owner understands where it appears: `Public phone number`, helper text `Shown to your customers if online booking is ever unavailable. Leave blank to hide it.`

Run `npx supabase db reset` afterwards to confirm the schema rebuilds cleanly.

- [ ] **Step 1: Implement**

When either route returns 402, render an inline message (not a toast, it must persist):

> This company is not taking new online bookings right now. Your scheduled cleanings are not affected.

Followed, when the org has a phone number available in the data the homeowner already has:

> To book, call them on {phone}.

If no phone is available, omit the second line entirely rather than printing an empty label.

Hard constraints, all from the research:
- Never mention billing, subscriptions, trials, payment, or suspension. The homeowner is not our customer and this is not their problem.
- Never render a 404 or an error page. Shopify makes a lapsed merchant's storefront vanish and GoDaddy's parked page looks hacked; both make the innocent third party conclude the business is gone.
- The tenant's existing branding stays on the page. This is one of the few surfaces that remains fully white-labelled, because it is the tenant's relationship with their customer, not ours with the tenant.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git commit -am "feat(billing): give blocked homeowners a way around the block"
```

---

### Task 14: E2E coverage for the escape hatch **[Sonnet]**

**This task is not optional and is not a formality.** Asana shipped a trial-expiry modal whose "go back to a free plan" escape silently disappeared for some users, leaving a non-dismissible wall over their own data, and the complaint thread ran for years. Our "View your data" button is the same affordance with the same failure mode. It gets tested as hard as the pay path.

**Files:**
- Create: `tests/e2e/billing-paywall.spec.ts`

⚠ **Revised 2026-09-22.** As drafted this suite could never pass in CI. Playwright runs against the Vercel preview, where `NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED` is unset, so every surface in this plan renders `null` and every assertion fails. The suite also has a single shared login (`tests/e2e/settings.spec.ts:3-17`) and no billing seeding helper.

Two things are therefore required, and the second is an ops action:

1. **The spec guards itself.** At the top:
   ```ts
   const billingUiOn = process.env.NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED === 'true'
   test.skip(!billingUiOn, 'billing UI is flag-dark in this environment')
   ```
   So it passes locally with the flag set, and skips rather than fails elsewhere.
2. **Add `NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED=true` to the Vercel PREVIEW environment only.** Not production. Previews are not customer-facing, every pre-existing org is comped by the §5.3 migration, and the server flag stays off, so nothing is actually enforced; only the UI becomes visible so it can be tested. Without this the suite is a no-op and the Asana regression it exists to catch ships unguarded. **Record this in the ops checklist and flag it to Bridger; do not set it yourself.**

A guarded suite that always skips is worse than no suite, because it reads as coverage. If the ops step is refused, say so in the PR description rather than leaving a silently-skipping spec behind.

- [ ] **Step 1: Write the spec**

Follow the structure of `tests/e2e/settings.spec.ts` for auth and fixture setup.

Cases:
1. A frozen org's owner lands on the wall. Assert the headline and that `PlanPicker` rendered.
2. **Clicking `View your data` dismisses the wall and reveals the real dashboard.** Assert a known dashboard element is visible and the wall is gone.
3. **After escaping, the view-only bar is still present.** The user must never be in a state where they are read-only and not told so.
4. **The `New booking` button is visible and reopens the wall.** Assert the wall returns.
5. `View your data` works a second time after the wall is reopened. This is the specific Asana regression: an escape that works once and then does not.
6. A frozen org's **manager** sees the neutral explanation bar and **no wall**.
7. A trialing org with more than 3 days left sees the pill and **no banner and no wall**.

- [ ] **Step 2: Run against local dev**

```bash
npm run dev    # separate terminal
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e -- billing-paywall
```
Expected: 7 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/billing-paywall.spec.ts
git commit -m "test(billing): cover the paywall escape hatch end to end"
```

---

### Task 15: Exclude ACH from the Checkout Session **[Opus]**

Two lines of money code, but they close a live footgun, so they get their own review.

ACH Direct Debit is fully supported for `mode: 'subscription'`. Because
`createBillingCheckoutSession` passes no `payment_method_types` (correct, and required by the
Stripe guidance), **enabling ACH in the Stripe Dashboard would turn it on in production with
zero code change.** The ops checklist tells Bridger to enable Apple Pay and Google Pay on
exactly that Dashboard screen, so this is a realistic misfire, not a hypothetical one.

It must stay off because it would silently break the paywall. Stripe Billing documents that
with ACH a subscription "can move directly to `active` after creation and bypass
`incomplete`. If the payment fails later, Stripe voids the invoice but the subscription
remains `active`." ACH settles at T+4 business days and a consumer account can return the
debit for up to 60 days, so `subscription_status === 'active'`, which `deriveBillingAccess`
treats as proof of payment, would stop meaning paid and stay wrong after failure.

**Files:**
- Modify: `src/lib/stripe/billing.ts` (`createBillingCheckoutSession`, near line 159)
- Modify: `src/lib/stripe/billing.test.ts` or the nearest existing wrapper test

- [ ] **Step 1: Write the failing assertion**

Add to the existing `createBillingCheckoutSession` wrapper test, which already pins the
Stripe payload:

```ts
it('excludes ACH so a Dashboard toggle cannot silently enable it', async () => {
  await createBillingCheckoutSession(validInput)
  const params = sessionsCreate.mock.calls[0][0]
  expect(params.excluded_payment_method_types).toEqual(['us_bank_account'])
  // Still no payment_method_types: dynamic payment methods stay on, so wallets work.
  expect(params).not.toHaveProperty('payment_method_types')
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/lib/stripe/billing.test.ts`
Expected: FAIL, `excluded_payment_method_types` is undefined

- [ ] **Step 3: Implement**

In the params object inside `createBillingCheckoutSession`, beside `billing_address_collection`:

```ts
    // ACH Direct Debit is deliberately excluded. It IS supported for subscriptions, and
    // because we pass no payment_method_types, enabling it in the Dashboard would turn it
    // on here with no code change. An ACH subscription stays `active` after a failed debit
    // (Stripe voids the invoice but not the subscription), and settlement is T+4 with a
    // 60-day consumer return window, so the paywall would unfreeze an org it could never
    // re-freeze. Spec §10.8 lists the nine changes required before this line may be removed.
    excluded_payment_method_types: ['us_bank_account'],
```

Do **not** reach for `payment_method_types` instead. That parameter is forbidden: it disables
dynamic payment methods and would take the wallets down with it.
Verified present in the pinned SDK at
`node_modules/stripe/types/Checkout/SessionsResource.d.ts:124`.

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run src/lib/stripe/billing.test.ts && npm run test:integration -- billing/checkout`
Expected: PASS. The second command confirms the checkout route still builds a valid session.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe/billing.ts src/lib/stripe/billing.test.ts
git commit -m "fix(billing): exclude ACH from subscription Checkout"
```

---

## Out of scope for PR F

Named so no implementer wanders into them:

- **PR G, the platform back office** (comp/un-comp, extend, pause/resume, cancel, tenant notes, roster billing columns, the `unpaid` case for operators). PR F touches nothing under `/owner`.
- **Changing PR E's hosted Checkout to embedded** (ruling R10, explicitly decided against).
- **Engagement-gating the trial extension.** The evidence says it is not a conversion lever, but gating it is a behaviour change with its own design. Possible later refinement, not this PR.
- **The annual renewal reminder email** (15 to 45 days, required by California's ARL for auto-renewing subscriptions). This is a real compliance obligation with no owner in any current spec. It is an email, not UI. **Raise it as a new backlog item; do not build it here.**
- **Flipping any flag.** PR F ships dark.
- **The post-delete "1 seat is now open" message** (spec §9 and §13). Found missing by review on 2026-09-22: it was in neither a task nor this list. It belongs with the Cleaners page work in Task 10; add it there as a toast after a successful cleaner delete, worded `That frees one seat. You now have {n} of {cap} seats in use.` and shown only when `uiEnabled && access.seatCap !== null`.

## Pre-flag-flip additions to the ops checklist

To be appended to the existing checklist in the Phase 1b ledger, not done in this PR:

- **Enable Apple Pay, Google Pay and Link** in the Stripe Dashboard payment method configuration. Apple Pay is the largest measured conversion lever in the research (Stripe's own holdback: +22.3% conversion), our buyers are mobile-heavy, and this is configuration rather than code: we already omit `payment_method_types`, so dynamic payment methods surface the wallets once they are switched on.
  - **No Apple Pay domain verification is required.** An earlier draft of this plan said otherwise and was wrong. Domain registration applies only to embedded Checkout and Elements; hosted Checkout renders on `checkout.stripe.com`, which Stripe has already registered.
  - Stripe hides each wallet automatically on devices that cannot use it, so a Windows user never sees Apple Pay. No defensive code.
  - Wallet **ordering is not merchant-controllable** on hosted Checkout, so the "default the wallet" finding is not actionable for us. Accepted consequence of ruling R10.
  - ⚠️ **Do NOT enable ACH Direct Debit on the same screen.** See Task 15 and spec §10.8.
- Verify that the amount shown by `/api/billing/plan/preview` matches the amount Stripe actually charges, by hand, in test mode, for a monthly to annual switch. Every Stripe call in our tests is mocked, so this arithmetic has never been checked against the real API.

## Self-Review

Run before handing this plan to an executor.

**Spec coverage.** §13 Operator: Settings > Billing (Task 9), shell pill and banner (Task 8), paywall (Task 7), Cleaners seat UI (Task 10), checkout return (Task 11). §13 Homeowner (Task 13). §13 Cleaner: no change, correct, cleaners are on a different shell. §12 client integration: four entry points and the 402 net (Task 12), `deriveBillingAccess` on the client (Tasks 3 and 5). §7 states: all eight branch in Task 9 and are exercised by Tasks 7 and 8.

**Gaps deliberately accepted.** Spec §13 says the Settings picker is inline; ruling R3 changes it to a sub-flow, recorded above. Spec §13's seat-cap copy links to Billing; ruling R16 replaces it with inline resolution, recorded above. Both are documented deviations, not omissions.

**Type consistency.** `BillingStatePayload` (Task 3) is consumed by name in Tasks 5 and 6. `PlanPreviewPayload` (Task 4) is consumed in Tasks 5, 6 and 10. `PlanSelectionBody` (Task 5) is the body type for Tasks 6, 7 and 10. `StepperProps` (Task 1) is consumed in Task 6. `ShellBannerProps` (Task 2) is consumed in Task 8. `usePaywall` (Task 7) is consumed in Tasks 8 and 12.

**Known soft spots**, flagged rather than hidden:
- ~~Task 3 and Task 4 tests use fixture helper names that may not match.~~ **Resolved 2026-09-22.** They did not match, and review caught it. Both test suites are now written against the verified API: `withTestOrg(opts?)` returns a fixture, `admin` is seeded as an admin, `callRoute` returns a parsed `body`, auth is `bearerHeader`. The lesson generalises: this plan asserted a dozen things about the codebase without opening the files, and roughly half were wrong, while every claim it made about the Stripe SDK was verified and correct.
- Task 4's `sumTax` reads `total_taxes`, whose shape varies by Stripe API version. The pinned version is `2025-12-15.clover`. Verify against a real test-mode preview before trusting the tax line in production.
- Task 7's reassurance counts depend on data already being in cache. The task explicitly permits dropping the counts rather than adding a query.
