# R4 Sub-project B: System States — Design

**Date:** 2026-07-04
**Status:** Approved (design), pending spec review
**Part of:** R4 launch polish (the last redesign gate before the pilot). Sibling sub-projects: A = auth screens (shipped, PR #126), C = onboarding wizard (later).

## Goal

Give every redesign surface a complete set of "system states" so nothing fails
silently and every dead end is branded: a custom 404, a real error boundary, a
reusable in-app error state, working toast feedback, and loading/empty coverage
on every data-fetching screen.

## Why now

An audit of the three shipped redesign surfaces (Operator, Cleaner, Homeowner)
found three gaps that all read as "unfinished" in a pilot:

1. **Toasts render nowhere in the redesign.** The branded `toast()` (`src/components/ui/toast.tsx`) has no `<Toaster>` mounted anywhere in the app tree (only in the dev `/ui-kit` page), so every redesign `toast()` call, the entire Homeowner surface, Cleaner message threads, the new-booking form, Operator messages, is silently dropped in production. Meanwhile Operator screens + `useCleanerData`/`useNotifications` still call the legacy `showToast` (`src/contexts/ToastContext.tsx`), which renders in the old yellow `primary-*` ramp, off-brand inside the redesigned UI.
2. **~13 of 18 screens show nothing when their data query fails.** TanStack Query's `isError` is a state, not a thrown error, so a route-level error boundary never sees it. Every data container needs an explicit error state.
3. **No custom 404 and no error boundary exist at all** (`src/app` has no `not-found.tsx`, `error.tsx`, or `global-error.tsx`), so an unmatched route or a render crash shows the raw Next.js default.

## UI implementation & styling source

The browser-companion mockups produced during brainstorming are **UX/structure
reference only**. Every screen is implemented from the design system: the
primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` +
`src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft
`shadow-soft-*`, the `rounded-*` scale). Do not copy raw hex, ad-hoc colors, or
bespoke classes from a mockup. Status/urgency is expressed in the badge/pill
vocabulary, never decorative stripes.

## Locked visual direction (404 + error pages)

**Layout 2 — message-first / eyebrow** (chosen over a ghost-numeral watermark and
an iconographic treatment). Composition, top to bottom, centered:

- Nexxus lockup (`<Logo />`, color-on-light) near the top.
- A small brand-blue uppercase **eyebrow** label (e.g. `Error 404`).
- A large `text-foreground` **headline** (font-weight 800).
- One line of muted body copy.
- Up to two stacked buttons: a primary (`bg-primary` / brand blue, white text) and an outline secondary.

Rationale: the eyebrow recipe is identical across the 404 and the error page (only
the words change), it is fully accessible (real contrast, no faint decorative
text), and it degrades gracefully to the worst case (an error with no iconic
number). The same message-first vocabulary also backs the in-app `ErrorState`.

## Architecture

| Concern | Mechanism | Notes |
|---|---|---|
| Data hook returned `isError` | `ErrorState` primitive, rendered inline in the container | A route boundary cannot catch query state |
| A component actually threw during render | `error.tsx` / `global-error.tsx` | React error boundary with `reset()` |
| Unmatched route or `notFound()` | `not-found.tsx` | Branded 404 |
| Toast feedback | mount branded `<Toaster>` once + migrate call sites | One system across the redesign |

**Token/scope facts that make this simple (verified):**
- Redesign semantic tokens (`--background`, `--foreground`, `--popover`, `--border`, `--destructive`, `--muted`, `--primary`, `--ring`) are defined on global `:root` in `globals.css`, not scoped under `.redesign`.
- `positive` / `caution` / `info` and `soft-sm|md|lg` shadows are static Tailwind theme values in `tailwind.config.js` (the shadows read `--shadow-rgb`, also on `:root`).
- Therefore a `<Toaster>` (which already carries the `redesign-overlay` class for the redesign font and portals to `document.body`) renders correctly from a single mount point covering Operator + Cleaner + Homeowner.
- Auth pages (`login`, `forgot-password`, `reset-password`, `accept-invite`) use inline errors (`AuthError`), not toasts, so they are untouched.

## Delivery: two PRs

- **Slice 1 (PR 1) — Foundations & global pages.** New primitives + the three route-level system pages + toast unification. Self-contained and independently testable.
- **Slice 2 (PR 2) — Screen state sweep.** Apply the primitives to every data-fetching redesign container.

---

## Slice 1 — Foundations & global pages

### 1. `SystemStatePage` (new, client)

`src/components/redesign/shared/SystemStatePage.tsx`

The Layout-2 full-page shell, reused by both `not-found` and `error`. Presentational
only; performs no data fetching so it can never itself throw.

```
type SystemStateAction = { label: string; href?: string; onClick?: () => void; variant?: 'primary' | 'outline' }
function SystemStatePage(props: {
  eyebrow: string
  title: string
  description: string
  actions: SystemStateAction[]   // rendered in order, stacked, max 2
}): JSX.Element
```

- Wraps content in `<div className="redesign font-jakarta ...">` so it gets the warm canvas + Jakarta font even though the page sits outside the `(redesign)` route group.
- Renders `<Logo />` (color-on-light), the eyebrow (`text-primary`, uppercase, tracked), the headline (`text-foreground`, `font-extrabold`), the body (`text-muted-foreground`), and the actions using the existing `Button` primitive (`asChild` + `<a>`/`<Link>` for `href` actions; `onClick` for the rest).
- Centered, min-height screen, max-width content column, responsive (single column on mobile, same layout on desktop).

### 2. `src/app/not-found.tsx` (new, client)

Branded 404 via `SystemStatePage`.

- Eyebrow: `Error 404`
- Title: `We couldn't find that page`
- Description: `The page you're looking for moved or never existed. Let's get you back on track.`
- Actions: primary `Back to home` -> `/`; secondary `Go to your dashboard` -> role dashboard resolved from `useAuth()` (`/{role}-dashboard`), omitted when signed out.

### 3. `src/app/error.tsx` (new, client)

React error boundary for the app segment tree. Standard Next.js signature
`({ error, reset }: { error: Error & { digest?: string }; reset: () => void })`.

- `useEffect` logs `error` to the console (forensic; keeps existing behavior of surfacing digests).
- Renders `SystemStatePage`:
  - Eyebrow: `Something went wrong`
  - Title: `This one's on us`
  - Description: `A part of the app failed to load. Try again, and if it keeps happening, let us know.`
  - Actions: primary `Try again` -> `reset()`; secondary `Back to home` -> `/`.

### 4. `src/app/global-error.tsx` (new, client)

Fallback for a crash in the **root layout itself**, where the app shell and
providers are gone. Must render its own `<html><body>`. Because it cannot rely on
`useAuth`, the design-system components, or (safely) the app stylesheet, it is a
**self-contained, dependency-light** variant: the same message-first look built
with inline styles (brand blue eyebrow, dark headline, warm background, one
`Try again` button calling `reset()` and a `Back to home` link). No hooks beyond
`useEffect` for logging.

Copy matches the error boundary (eyebrow `Something went wrong`, title
`This one's on us`, same body).

### 5. `ErrorState` primitive (new)

`src/components/ui/error-state.tsx`. The in-app companion to `EmptyState`, for
`query.isError`. Mirrors `EmptyState`'s container (dashed `rounded-card border
border-border bg-card/50`, centered, padded) so the two read as siblings.

```
function ErrorState(props: {
  icon?: React.ReactNode          // defaults to a TriangleAlert glyph
  title?: string                  // default: "Couldn't load this"
  description?: string            // default: "Something went wrong loading this. Please try again."
  onRetry?: () => void            // when set, renders a "Try again" Button
  action?: React.ReactNode        // escape hatch for a custom action instead of onRetry
}): JSX.Element
```

- Icon tint uses `text-destructive` (global token) at a restrained size, matching the muted treatment of `EmptyState`'s icon.
- `onRetry` renders `<Button variant="outline" onClick={onRetry}>Try again</Button>` (a retry is a secondary action, not the page's primary CTA).

### 6. Toast unification

**Mount:** add `<Toaster position="top-right" />` to `src/app/(redesign)/layout.tsx`
(inside the existing `.redesign font-jakarta` wrapper). One mount covers Operator,
Cleaner, and Homeowner because all redesign routes nest under that group layout,
and the Toaster portals to `document.body` regardless.

**Migrate** these call sites from legacy `showToast(msg, opts)` to branded `toast`:

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

**Mapping (mechanical):**
- `showToast(m, { variant: 'success' })` -> `toast.success(m)`
- `showToast(m, { variant: 'error' })` -> `toast.error(m)`
- `showToast(m, { variant: 'info' })` -> `toast.info(m)`
- `showToast(m)` / `{ variant: 'email' }` (legacy default) -> `toast(m)` (default variant)
- `description` / `duration` options pass through: `toast.success(m, { description, duration })`.
- `useNotifications` already computes its variant via `toastVariantForTone(tone)`, which returns `'success' | 'error' | 'info'`, exactly the branded `toast` method names, so it becomes `toast[variant](title, { description })`.

**Legacy `ToastContext` stays** for the pre-redesign dashboards (`admin-dashboard`,
`manager-dashboard`, and legacy modals like `AddAppointmentModal`,
`AddCustomerModal`, `AddTeamMemberModal`, etc.). It is not removed in this
sub-project; it is retired when legacy dashboards are.

**Guard:** after migration, no file under `src/components/redesign/**` and neither
shared hook imports `useToast` from `@/contexts/ToastContext`.

---

## Slice 2 — Screen state sweep

Apply the primitives to **every data-fetching redesign container**. Principle:

- **Error:** if the container reads a query, it renders `ErrorState` (with `onRetry` wired to the query's `refetch`) when `isError`.
- **Loading:** if the container reads a list/data query, it renders a `Skeleton` layout (not a bare spinner, not nothing) while `isLoading`.
- **Empty:** if the container renders a list, it renders `EmptyState` when the list is empty.
- Screens that are pure navigation menus or static forms with no data query do not get loading/empty, but any query they *do* make (e.g. profile load) gets an error state.

**Template to copy** (already correct): `CleanerTodayView`, `CleanerScheduleView`,
`HomeownerCleaningsView`.

### Confirmed gaps from the audit (must be fixed)

Error state missing (add `ErrorState` + retry):
- `src/components/redesign/overview/OperatorOverviewView.tsx` (and its `KpiStrip`, `NeedsYouNowQueue`)
- `src/components/redesign/bookings/OperatorBookingsView.tsx`
- `src/components/redesign/cleaners/OperatorCleanersView.tsx`
- `src/components/redesign/customers/OperatorCustomersView.tsx`
- `src/components/redesign/services/OperatorServicesView.tsx`
- `src/components/redesign/settings/OperatorSettingsView.tsx`
- `src/components/redesign/messages/OperatorMessagesView.tsx`
- `src/components/redesign/cleaner/today/CleanerTodayView.tsx`
- `src/components/redesign/cleaner/schedule/CleanerScheduleView.tsx`
- `src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx`
- `src/components/redesign/cleaner/profile/CleanerProfileView.tsx`
- `src/components/redesign/cleaner/messages/CleanerMessagesView.tsx`
- `src/components/redesign/cleaner/job/CleanerActiveJobView.tsx`
- `src/components/redesign/homeowner/cleanings/HomeownerCleaningsView.tsx`
- `src/components/redesign/homeowner/messages/HomeownerMessagesView.tsx`
- `src/components/redesign/analytics/OperatorAnalyticsView.tsx` (finish partial coverage)

Loading skeleton missing:
- `src/components/redesign/payments/OperatorPaymentsView.tsx`
- `src/components/redesign/messages/OperatorMessagesView.tsx`
- `src/components/redesign/cleaner/job/CleanerActiveJobView.tsx`

Empty state missing:
- `src/components/redesign/payments/OperatorPaymentsView.tsx` (e.g. "No payments yet")
- `src/components/redesign/messages/OperatorMessagesView.tsx` ("No conversations")
- `src/components/redesign/homeowner/messages/HomeownerMessagesView.tsx` ("No conversations")
- `src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx` (make the implicit mode-based empty explicit)

### Also in scope ("every screen")

The remaining data-fetching containers discovered alongside the audit, each gets
error coverage (and loading/empty where they render lists/data):
- Homeowner account sub-views: `HomeownerPaymentMethodsView`, `HomeownerProfileView`, `HomeownerPropertiesView`, `HomeownerPaymentHistoryView` (receipts), `HomeownerServicesView`
- Cleaner profile sub-views: `CleanerServicesCatalogView`, `CleanerServiceDetailView`, `CleanerChecklistView`
- Operator: `OperatorStaffView`
- Homeowner booking flow views (`BookingPicksView`, `BookingReviewView`) where they load availability/services.

The implementation plan enumerates each container with its exact query hook,
`isLoading`/`isError`/empty condition, and the retry target.

---

## Testing

- **Unit (`*.test.tsx` next to source):**
  - `ErrorState`: renders default and custom title/description; `onRetry` renders a "Try again" button that fires the callback; `action` escape hatch renders instead of the retry button.
  - `SystemStatePage`: renders eyebrow, title, description, and each action (href actions as links, onClick actions as buttons).
- **Toast migration:** no new tests required; existing integration tests that exercise success/error routes remain green. A grep guard (no `useToast` import in redesign surfaces) is part of the Slice 1 acceptance check.
- **Type-check + lint + full `npm run test`** pass before each PR push, per the standard gates.
- **Visual verification** with Playwright MCP against `npm run dev`: 404 (unmatched route), error boundary (temporary throw), and a representative screen's loading/empty/error states, at mobile and desktop widths.

## Global constraints

- Implement from the design system only (`src/components/ui/*` + tokens). No raw hex or mockup styling in shipped code.
- No em dashes in any user-facing copy (UI text, buttons, toasts, error messages).
- Cleaner- and homeowner-facing copy says "office", never "operator".
- Feature-branch + PR-to-master flow; branch protection on `master`. Two PRs (Slice 1, then Slice 2).
- Reuse legacy logic/hooks; build presentation fresh from the design system (no pre-redesign component imports).
```
