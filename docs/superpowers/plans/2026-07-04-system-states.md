# System States (R4-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every redesign surface a complete set of system states, a branded 404, a real error boundary, a reusable in-app `ErrorState`, working branded toasts, and loading/empty coverage on every data-fetching screen.

**Architecture:** New presentational primitives (`ErrorState`, `SystemStatePage`) built from the design system; three Next.js route-level system files (`not-found.tsx`, `error.tsx`, `global-error.tsx`); the branded `<Toaster>` mounted once in the redesign group layout with all legacy `showToast` call sites migrated to it. Then a sweep applies the primitives to every data-fetching container. Ships as two PRs (Slice 1 foundations, Slice 2 sweep).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, the `src/components/ui/*` design-system primitives.

## Global Constraints

- Implement from the design system only (`src/components/ui/*` primitives + tokens in `tailwind.config.js` / `src/app/globals.css`). Brand `#0150FC`, Plus Jakarta Sans, warm canvas, `shadow-soft-*`, `rounded-*` scale. No raw hex or mockup-copied styling in shipped `.tsx` (the one deliberate exception is `global-error.tsx`, which must be self-contained inline styles because the app shell/CSS may be gone at that point).
- The browser-companion mockups are UX/structure reference only. The 404/error visual is "Layout 2": centered lockup, brand-blue uppercase eyebrow, extrabold headline, one muted body line, up to two stacked `Button`s.
- No em dashes in any user-facing copy (UI text, buttons, toasts, error messages). Use periods, commas, parentheses, or "to" for ranges.
- Cleaner- and homeowner-facing copy says "office", never "operator". (The 404/error copy is role-generic.)
- Feature-branch + PR-to-master; branch protection on `master`. Slice 1 on `feat/system-states-slice-1`, Slice 2 on its own branch off updated master.
- Reuse legacy logic/hooks; build presentation fresh from the design system. No pre-redesign component imports.
- **Testing reality:** the repo has no component-render harness (vitest `environment: 'node'`, no jsdom/testing-library). Pure logic gets a `.test.ts`. Presentational components are verified by `npx tsc --noEmit` + `npm run lint` + Playwright MCP visual checks against `npm run dev`. Do not add a test harness.
- Before every push: `npm run test` green, `npx tsc --noEmit` shows no new errors, `npm run lint` clean.

## Reference: confirmed APIs (do not re-derive)

- **`Button`** (`@/components/ui/button`): `variant` in `default | secondary | outline | ghost | destructive | link` (`default` = brand primary), `size` in `default(h-11) | sm | lg(h-12) | icon`, plus `asChild`, `loading`. Shape is `rounded-pill`.
- **`EmptyState`** (`@/components/ui/empty-state`): `{ icon?, title, description?, action? }`. Container is `rounded-card border border-dashed border-border bg-card/50 px-6 py-12 text-center`; icon wrapper `text-muted-foreground [&_svg]:size-10`.
- **`Skeleton`** (`@/components/ui/skeleton`): `<Skeleton className="h-40 w-full rounded-card" />`.
- **`Logo`** (`@/components/ui/logo`): `variant="full"`, color-on-light by default; height via `className="h-8 w-auto"`.
- **`toast`** (`@/components/ui/toast`): `toast(title, opts?)`, `toast.success/error/info/warning(title, opts?)`, `toast.dismiss(id)`; `opts = { description?, duration? }`. `<Toaster position="top-right" />` renders them (portals to `document.body`, carries `redesign-overlay`).
- **`getDashboardPath`** (`@/lib/redesign/dashboardPath`): `(role: string, { redesign?: boolean }) => string`; returns `/` for unknown role.
- **`redesignUiEnabled`** (`@/lib/redesign/flags`): client-safe boolean from `NEXT_PUBLIC_REDESIGN_ENABLED`.
- **`useAuth`** (`@/hooks/useAuth`): returns `{ user: User | null, ... }`; `user.role` is `'cleaner' | 'manager' | 'admin' | 'homeowner'`.
- **Container/View split:** most screens are a `*View.tsx` (presentational, receives `data`/`loading` as props and renders `Skeleton`/`EmptyState` from them) plus a Container that owns the query. `CleanerTodayView` is the canonical template: `if (loading) return <Skeleton .../>` then `if (data.isEmpty) return <EmptyState .../>`.

---

## Slice 1 — Foundations & global pages (PR 1, branch `feat/system-states-slice-1`)

### Task 1: `ErrorState` primitive

**Files:**
- Create: `src/components/ui/error-state.tsx`
- Modify: `src/app/(dev)/ui-kit/page.tsx` (add a showcase block for visual verification)

**Interfaces:**
- Produces: `ErrorState({ icon?, title?, description?, onRetry?, action? })` — the in-app query-error component, sibling to `EmptyState`.

- [ ] **Step 1: Create the primitive**

`src/components/ui/error-state.tsx`:

```tsx
import * as React from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ErrorState({
  icon,
  title = "Couldn't load this",
  description = 'Something went wrong loading this. Please try again.',
  onRetry,
  action,
}: {
  icon?: React.ReactNode
  title?: string
  description?: string
  onRetry?: () => void
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="mb-4 text-destructive [&_svg]:size-10">{icon ?? <TriangleAlert />}</div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ??
        (onRetry ? (
          <div className="mt-6">
            <Button variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null)}
    </div>
  )
}
```

- [ ] **Step 2: Showcase it in the ui-kit gallery**

In `src/app/(dev)/ui-kit/page.tsx`, import `ErrorState` and add a section next to the existing `EmptyState` demo:

```tsx
<ErrorState title="Couldn't load payments" description="Something went wrong loading this. Please try again." onRetry={() => {}} />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Visual verify**

With `npm run dev` running, navigate to `http://localhost:3000/ui-kit`, confirm `ErrorState` renders with the dashed card, red alert icon, title, description, and an outline "Try again" button. Screenshot via Playwright MCP.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/error-state.tsx "src/app/(dev)/ui-kit/page.tsx"
git commit -m "feat(redesign): ErrorState primitive for query failures"
```

### Task 2: `SystemStatePage` shell

**Files:**
- Create: `src/components/redesign/shared/SystemStatePage.tsx`

**Interfaces:**
- Consumes: `Button`, `Logo`.
- Produces: `SystemStatePage({ eyebrow, title, description, actions })` and `type SystemStateAction = { label: string; href?: string; onClick?: () => void; variant?: 'primary' | 'outline' }`. Used by `not-found.tsx` and `error.tsx`.

- [ ] **Step 1: Create the shell**

`src/components/redesign/shared/SystemStatePage.tsx`:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'

export type SystemStateAction = {
  label: string
  href?: string
  onClick?: () => void
  variant?: 'primary' | 'outline'
}

export function SystemStatePage({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions: SystemStateAction[]
}) {
  return (
    <div className="redesign font-jakarta flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <Logo variant="full" className="h-8 w-auto" />
      <div className="mt-12 flex w-full max-w-sm flex-col items-center">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        {actions.length > 0 && (
          <div className="mt-8 flex w-full flex-col gap-3">
            {actions.map((a, i) => {
              const variant = a.variant === 'outline' ? 'outline' : 'default'
              return a.href ? (
                <Button key={i} asChild variant={variant} size="lg" className="w-full">
                  <Link href={a.href}>{a.label}</Link>
                </Button>
              ) : (
                <Button key={i} variant={variant} size="lg" className="w-full" onClick={a.onClick}>
                  {a.label}
                </Button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/shared/SystemStatePage.tsx
git commit -m "feat(redesign): SystemStatePage shell for 404/error pages"
```

### Task 3: `not-found.tsx` and `error.tsx`

**Files:**
- Create: `src/app/not-found.tsx`
- Create: `src/app/error.tsx`

**Interfaces:**
- Consumes: `SystemStatePage`, `SystemStateAction`, `useAuth`, `getDashboardPath`, `redesignUiEnabled`.

- [ ] **Step 1: Create `not-found.tsx`**

```tsx
'use client'

import { SystemStatePage, type SystemStateAction } from '@/components/redesign/shared/SystemStatePage'
import { useAuth } from '@/hooks/useAuth'
import { getDashboardPath } from '@/lib/redesign/dashboardPath'
import { redesignUiEnabled } from '@/lib/redesign/flags'

export default function NotFound() {
  const { user } = useAuth()
  const actions: SystemStateAction[] = [{ label: 'Back to home', href: '/', variant: 'primary' }]
  if (user?.role) {
    actions.push({
      label: 'Go to your dashboard',
      href: getDashboardPath(user.role, { redesign: redesignUiEnabled() }),
      variant: 'outline',
    })
  }
  return (
    <SystemStatePage
      eyebrow="Error 404"
      title="We couldn't find that page"
      description="The page you're looking for moved or never existed. Let's get you back on track."
      actions={actions}
    />
  )
}
```

- [ ] **Step 2: Create `error.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import { SystemStatePage } from '@/components/redesign/shared/SystemStatePage'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app error boundary]', error)
  }, [error])

  return (
    <SystemStatePage
      eyebrow="Something went wrong"
      title="This one's on us"
      description="A part of the app failed to load. Try again, and if it keeps happening, let us know."
      actions={[
        { label: 'Try again', onClick: () => reset(), variant: 'primary' },
        { label: 'Back to home', href: '/', variant: 'outline' },
      ]}
    />
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Visual verify both**

With `npm run dev`: navigate to a bogus path like `http://localhost:3000/this-does-not-exist` and confirm the branded 404 (eyebrow "Error 404", headline, "Back to home", and "Go to your dashboard" when signed in). To exercise `error.tsx`, temporarily throw in a page (e.g. add `throw new Error('boom')` at the top of a client page), confirm the error boundary renders with a working "Try again", then remove the throw. Screenshot both via Playwright MCP at mobile (390px) and desktop (1280px) widths.

- [ ] **Step 5: Commit**

```bash
git add src/app/not-found.tsx src/app/error.tsx
git commit -m "feat(redesign): branded 404 and error boundary"
```

### Task 4: `global-error.tsx` (standalone root-crash fallback)

**Files:**
- Create: `src/app/global-error.tsx`

**Interfaces:**
- Consumes: nothing from the app (must be self-contained — the root layout crashed, so providers/design-system/CSS may be unavailable).

- [ ] **Step 1: Create the standalone page**

```tsx
'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global error]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F7F6F3',
          color: '#211E1A',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: '4rem 1.5rem',
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#0150FC', margin: 0 }}>
          Something went wrong
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '12px 0 0' }}>This one&rsquo;s on us</h1>
        <p style={{ maxWidth: 340, color: '#6B6459', margin: '12px 0 0', lineHeight: 1.5 }}>
          A part of the app failed to load. Try again, and if it keeps happening, let us know.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          <button
            onClick={() => reset()}
            style={{ height: 48, padding: '0 24px', borderRadius: 999, border: 'none', background: '#0150FC', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{ height: 48, padding: '0 24px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1px solid #E6E2DB', color: '#211E1A', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
          >
            Back to home
          </a>
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/global-error.tsx
git commit -m "feat(redesign): self-contained global-error fallback"
```

### Task 5: Mount the branded `<Toaster>`

**Files:**
- Modify: `src/app/(redesign)/layout.tsx`

**Interfaces:**
- Consumes: `Toaster` from `@/components/ui/toast`.
- Produces: redesign `toast()` calls now render app-wide across Operator/Cleaner/Homeowner.

- [ ] **Step 1: Add the import and mount**

In `src/app/(redesign)/layout.tsx`, add `import { Toaster } from "@/components/ui/toast";` and render it inside the `.redesign` wrapper:

```tsx
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">
        {children}
        <Toaster position="top-right" />
      </div>
    </ThemeProvider>
  );
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Visual verify**

With `npm run dev`, open a redesign screen that fires a toast (e.g. the homeowner property form save, or trigger `toast.success('test')` from the console on a redesign route) and confirm a branded top-right toast appears. Screenshot via Playwright MCP.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(redesign)/layout.tsx"
git commit -m "fix(redesign): mount branded Toaster so redesign toasts render"
```

### Task 6: Migrate `showToast` -> branded `toast`

**Files (modify each):**
- `src/components/redesign/bookings/OperatorBookings.tsx`
- `src/components/redesign/cleaners/OperatorCleaners.tsx`
- `src/components/redesign/cleaners/OperatorStaff.tsx`
- `src/components/redesign/customers/OperatorCustomers.tsx`
- `src/components/redesign/payments/OperatorPayments.tsx`
- `src/components/redesign/payments/RecordPaymentDialog.tsx`
- `src/components/redesign/services/OperatorServices.tsx`
- `src/components/redesign/settings/useSettingsSection.ts`
- `src/hooks/useCleanerData.ts`
- `src/hooks/useNotifications.ts`

**Interfaces:**
- Consumes: `toast` from `@/components/ui/toast`.
- Produces: legacy `ToastContext` no longer imported by any redesign surface or shared hook. `ToastContext` itself stays (pre-redesign dashboards still use it) and is NOT modified.

- [ ] **Step 1: Swap imports and calls in each file**

In every listed file, remove `import { useToast } from "@/contexts/ToastContext";` (path may be relative, e.g. `'../contexts/ToastContext'`) and the `const { showToast } = useToast();` line, and add `import { toast } from "@/components/ui/toast";` (match the file's existing import style/quotes). Then rewrite calls by this mapping (a real example from `OperatorServices.tsx`):

```tsx
// before
showToast("Service updated", { variant: "success" });
showToast(r.error || "Could not update the service", { variant: "error" });
// after
toast.success("Service updated");
toast.error(r.error || "Could not update the service");
```

Mapping:
- `{ variant: 'success' }` -> `toast.success(msg, restOpts)`
- `{ variant: 'error' }` -> `toast.error(msg, restOpts)`
- `{ variant: 'info' }` -> `toast.info(msg, restOpts)`
- no variant / `{ variant: 'email' }` -> `toast(msg, restOpts)`
- carry `description` / `duration` through as the second arg, e.g. `toast.success(msg, { description, duration })`.

For `useNotifications.ts`, the dynamic case (line ~88) becomes:

```tsx
const d = describeNotification(row.event_type, row.payload)
toast[toastVariantForTone(d.tone)](d.title, { description: d.description })
```

(`toastVariantForTone` returns `'success' | 'error' | 'info'`, all valid `toast` methods. Preserve any `description` the notification carries; drop it if `describeNotification` has no such field.) The static calls at lines ~183/188 map as above.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Guard — no legacy toast left in redesign surfaces**

Run:
```bash
grep -rn "useToast\|ToastContext" src/components/redesign src/hooks/useCleanerData.ts src/hooks/useNotifications.ts
```
Expected: no matches.

- [ ] **Step 4: Full test + lint**

Run: `npm run test` and `npm run lint`
Expected: green (these files are covered by existing integration tests for the affected routes).

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign src/hooks/useCleanerData.ts src/hooks/useNotifications.ts
git commit -m "refactor(redesign): unify operator toasts onto branded toast()"
```

### Slice 1 wrap-up

- [ ] Push `feat/system-states-slice-1`, open PR to `master`, ensure the four required checks pass, run the pre-push adversarial review, then merge.

---

## Slice 2 — Screen state sweep (PR 2)

> Authored after the per-container manifest. Applies `ErrorState` (with retry), plus any missing `Skeleton`/`EmptyState`, to every data-fetching redesign container. See canonical pattern below; tasks follow.

### Canonical pattern (reference for every Slice 2 task)

Two shapes, matching the Container/View split:

**Shape A — the View owns the query** (it calls a hook directly). Add an error guard using the hook's `isError` + `refetch`, ordered error -> loading -> empty -> content:

```tsx
const { data, isLoading, isError, refetch } = useSomeQuery(...)
if (isError) return <ErrorState onRetry={() => refetch()} />
if (isLoading) return <Skeleton className="h-40 w-full rounded-card" />
if (list.length === 0) return <EmptyState icon={<Icon />} title="..." description="..." />
```

**Shape B — the View is prop-driven** (a Container owns the query and passes `data`/`loading`). Add `error?: boolean` and `onRetry?: () => void` props to the View, render `<ErrorState onRetry={onRetry} />` as the first guard, and in the Container destructure `isError`/`refetch` from the query hook and pass them down:

```tsx
// View
if (error) return <ErrorState onRetry={onRetry} />
if (loading) return <Skeleton ... />
if (data.isEmpty) return <EmptyState ... />

// Container
const { data, isLoading, isError, refetch } = useThing(...)
return <ThingView data={...} loading={isLoading} error={isError} onRetry={() => refetch()} ... />
```

Copy rules for the states: role-generic, no em dashes, "office" not "operator" on cleaner/homeowner screens. Each error title is specified per container in the tasks below; the description defaults to `ErrorState`'s "Something went wrong loading this. Please try again."

**Manifest reconciliation (important):** a per-file read found that loading and
empty states are *already implemented* on all 15 data-fetching Views (the first
rough audit overstated the gaps). The real universal gap is **error states**:
19 Views can have their query fail and render nothing. `CleanerActiveJobView`,
`OperatorSettingsView`, `CleanerProfileView`, `HomeownerAccountHubView`,
`HomeownerProfileView`, `BookingPicksView` have no data query and are out of
scope. So Slice 2 is an error-state sweep plus the small hook surfacing Task 7
needs. `HomeownerPaymentMethods` already implements the target pattern (its
Container passes `error={error}` from `useSavedPaymentMethods`) — copy it.

### Task 7: Surface `error` + `refetch` on hooks that lack them

Some aggregated hooks expose `isLoading` but not `error`/`refetch`, which the
error wiring needs. Add them to each hook's return (they come free from the
underlying `useOrgQuery`/`useQuery` — just include them).

**Files (modify):**
- `src/hooks/useAdminData.ts` — `usePaymentStats` (add `error` + `refetch`), `useAdminStats` (add `error` + `refetch`)
- `src/hooks/useCleanerData.ts` — `useCleanerAwaitingPayments` (add `refetch`; already has `error`), `useCleanerStats` (add `refetch`)
- `src/hooks/useHomeownerData.ts` — `useHomeownerProperties` (add `refetch`), `useHomeownerPayments` (add `refetch`)

**Interfaces:**
- Produces: each listed hook returns `error` (a boolean or message, matching the hook's existing convention) and `refetch: () => void`.

- [ ] **Step 1: For each hook, surface the fields from its underlying query**

Locate the `useOrgQuery`/`useQuery` call in each hook, capture its result object, and add the fields to the hook's return. Example shape (match each hook's existing return style and error convention, e.g. `query.error?.message ?? null` if that hook returns string errors, or `query.isError` if boolean):

```tsx
const query = useOrgQuery(...)
return {
  ...existingReturn,
  error: query.isError,        // or: query.error?.message ?? null, to match the hook's convention
  refetch: () => { void query.refetch() },
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks
git commit -m "feat(redesign): surface error+refetch on stats/list hooks for error states"
```

### Task 8a: Operator list-screen error states

Add error handling to the five single-list Operator screens. Each is Shape B.

**Files (modify, View + Container per screen):**
- `.../bookings/OperatorBookingsView.tsx` + `.../bookings/OperatorBookings.tsx` (hook `useAdminAppointments` -> `error`, `refetch`) — title `Couldn't load bookings`
- `.../cleaners/OperatorCleanersView.tsx` + `.../cleaners/OperatorCleaners.tsx` (hook `useAdminCleanerScorecards`) — title `Couldn't load cleaners`
- `.../cleaners/OperatorStaffView.tsx` + `.../cleaners/OperatorStaff.tsx` (hook `useAdminStaff`) — title `Couldn't load staff`
- `.../customers/OperatorCustomersView.tsx` + `.../customers/OperatorCustomers.tsx` (hook `useAdminCustomers`) — title `Couldn't load customers`
- `.../services/OperatorServicesView.tsx` + `.../services/OperatorServices.tsx` (hook `useServices`) — title `Couldn't load services`

**Interfaces:**
- Consumes: `ErrorState` (`@/components/ui/error-state`).
- Produces: each `*View` accepts `error?: boolean` and `onRetry?: () => void`.

- [ ] **Step 1: Add the error prop + guard to each View**

In each `*View`, add `error?: boolean` and `onRetry?: () => void` to the props type, import `ErrorState`, and add it as the FIRST guard (before the existing `if (loading)`), with the screen's title:

```tsx
import { ErrorState } from '@/components/ui/error-state'
// ...
if (error) return <ErrorState title="Couldn't load bookings" onRetry={onRetry} />
if (loading) return <BookingsSkeleton />   // existing
// existing empty + content
```

- [ ] **Step 2: Wire each Container to pass `error` + `onRetry`**

In each Container, pull the hook's error/refetch and pass them to the View, mirroring how it already passes `loading`:

```tsx
const appointments = useAdminAppointments()
// existing: loading={appointments.loading}
<OperatorBookingsView
  /* ...existing props... */
  loading={appointments.loading}
  error={Boolean(appointments.error)}
  onRetry={() => appointments.refetch()}
/>
```

(For a Container that composes several list hooks, OR the error to a boolean and make `onRetry` refetch each.)

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Visual verify one screen's error state**

With `npm run dev`, force a failure on one screen (e.g. temporarily make the hook's `queryFn` throw, or go offline) and confirm `ErrorState` renders with a working "Try again". Screenshot via Playwright MCP. Revert the forced failure.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/bookings src/components/redesign/cleaners src/components/redesign/customers src/components/redesign/services
git commit -m "feat(redesign): error states on operator list screens"
```

### Task 8b: Operator composite-screen error states

The screens that combine multiple hooks: Payments, Overview, Messages, Analytics.
Combine the hooks' errors into one boolean and a retry that refetches all.

**Files (modify, View + Container each):**
- `.../payments/OperatorPaymentsView.tsx` + `.../payments/OperatorPayments.tsx` (hooks `useAdminPaymentsInfinite`, `useAdminPayoutsInfinite`, `usePaymentStats`) — title `Couldn't load payments`
- `.../overview/OperatorOverviewView.tsx` + `.../overview/OperatorOverview.tsx` (hooks `useAdminAppointments`, `useAdminStats`, `usePaymentStats`) — title `Couldn't load your dashboard`
- `.../messages/OperatorMessagesView.tsx` + `.../messages/OperatorMessages.tsx` (hooks `useConversations`, `useOrgJobThreads`, `useAdminAppointments`) — title `Couldn't load messages`
- `.../analytics/OperatorAnalyticsView.tsx` + `.../analytics/OperatorAnalytics.tsx` (its stats hook) — title `Couldn't load analytics`. If the analytics container has no data query that can error, skip it and note so in the task report.

**Interfaces:**
- Consumes: `ErrorState`. Depends on Task 7 (`usePaymentStats`/`useAdminStats` now expose `error`/`refetch`).

- [ ] **Step 1: Add the error prop + guard to each View** (same shape as Task 8a; `OperatorOverviewView` and `OperatorMessagesView` render `ErrorState` in place of the delegated children when `error`).

- [ ] **Step 2: Wire each Container with a combined error + retry**

```tsx
const appts = useAdminAppointments()
const stats = useAdminStats()
const pay = usePaymentStats()
const error = Boolean(appts.error || stats.error || pay.error)
const onRetry = () => { appts.refetch(); stats.refetch(); pay.refetch() }
// pass error + onRetry to the View alongside the existing loading
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/payments src/components/redesign/overview src/components/redesign/messages src/components/redesign/analytics
git commit -m "feat(redesign): error states on operator composite screens"
```

### Task 9: Cleaner error states

**Files (modify, View + Container each):**
- `.../cleaner/today/CleanerTodayView.tsx` + `.../cleaner/today/CleanerToday.tsx` (hook `useCleanerAppointments`) — title `Couldn't load your day`
- `.../cleaner/schedule/CleanerScheduleView.tsx` + `.../cleaner/schedule/CleanerSchedule.tsx` (hook `useCleanerAppointments`) — title `Couldn't load your schedule`
- `.../cleaner/profile/CleanerServicesCatalogView.tsx` + `.../cleaner/profile/CleanerServicesCatalog.tsx` (hook `useServices`) — title `Couldn't load services`
- `.../cleaner/earnings/CleanerEarningsView.tsx` + `.../cleaner/earnings/CleanerEarnings.tsx` (hooks `useCleanerAwaitingPayments`, `useCleanerStats`) — title `Couldn't load earnings`
- `.../cleaner/messages/CleanerMessagesView.tsx` + `.../cleaner/messages/CleanerMessages.tsx` (hook `useConversations` + others) — title `Couldn't load messages`

**Interfaces:**
- Consumes: `ErrorState`. Depends on Task 7 (`useCleanerAwaitingPayments`/`useCleanerStats` now expose `refetch`).
- Copy note: cleaner-facing, so "office" not "operator" (none of these titles use either term; keep it that way).

- [ ] **Step 1: Add `error?`/`onRetry?` + `ErrorState` guard to each View** (same shape as Task 8a). For `CleanerEarningsView`, add the data-load `ErrorState` as the first guard; leave the existing Stripe-embed error message as-is (it is a separate concern).

- [ ] **Step 2: Wire each Container** to pass `error`/`onRetry` from its hook(s), OR-combining where there are several.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/cleaner
git commit -m "feat(redesign): error states on cleaner screens"
```

### Task 10: Homeowner error states

**Files (modify, View + Container each):**
- `.../homeowner/cleanings/HomeownerCleaningsView.tsx` + `.../homeowner/cleanings/HomeownerCleanings.tsx` (hook `useHomeownerAppointments`) — title `Couldn't load your cleanings`
- `.../homeowner/messages/HomeownerMessagesView.tsx` + `.../homeowner/messages/HomeownerMessages.tsx` (hooks `useConversations`, `useHomeownerAppointments`) — title `Couldn't load messages`
- `.../homeowner/account/properties/HomeownerPropertiesView.tsx` + `.../account/properties/HomeownerProperties.tsx` (hook `useHomeownerProperties`) — title `Couldn't load your properties`
- `.../homeowner/account/receipts/HomeownerPaymentHistoryView.tsx` + `.../account/receipts/HomeownerPaymentHistory.tsx` (hook `useHomeownerPayments`) — title `Couldn't load your receipts`
- `.../homeowner/account/services/HomeownerServicesView.tsx` + `.../account/services/HomeownerServices.tsx` (hook `useServices`) — title `Couldn't load services`

Reference (already done, do not change): `HomeownerPaymentMethodsView` + `HomeownerPaymentMethods` show the exact target pattern.

**Interfaces:**
- Consumes: `ErrorState`. Depends on Task 7 (`useHomeownerProperties`/`useHomeownerPayments` now expose `refetch`).
- Copy note: homeowner-facing, so "office" not "operator" (titles above avoid both).

- [ ] **Step 1: Add `error?`/`onRetry?` + `ErrorState` guard to each View** (same shape as Task 8a).

- [ ] **Step 2: Wire each Container** to pass `error`/`onRetry` from its hook(s).

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Visual verify a homeowner error state** via Playwright MCP (force a hook failure on one homeowner screen, confirm `ErrorState` + retry, revert).

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/homeowner
git commit -m "feat(redesign): error states on homeowner screens"
```

### Slice 2 wrap-up

- [ ] Run full `npm run test`, `npx tsc --noEmit`, `npm run lint`. Push the Slice 2 branch, open PR to `master`, ensure the four required checks pass, run the pre-push adversarial review, then merge.
