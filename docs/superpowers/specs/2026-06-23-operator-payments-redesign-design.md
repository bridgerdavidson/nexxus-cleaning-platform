# Operator Payments — redesign design spec

Date: 2026-06-23
Status: approved design, pre-implementation (revised after a 3-critic adversarial review)
Screen: Operator console **Payments** (the next screen in the Phase 2 redesign, after
Bookings/Customers/Services/Cleaners&team)
Branch (to create): `feat/redesign-operator-payments` **off current `master`**

This spec follows the established `(redesign)` Phase 2 conventions (see
`docs/redesign/2026-06-19-redesign-decisions.md` and the shipped Customers/Cleaners
screens). It is grounded in a code-verification pass over the real hooks, routes, and
primitives; file:line references below are to the live tree.

> **Working-tree note.** The redesign infrastructure — the `src/app/(redesign)` route
> group + layout gate, `src/components/redesign/shell/{OperatorShell,nav-items}`, the
> `src/components/ui/*` primitive kit, `src/lib/redesign/flags.ts` (`redesignUiEnabled`),
> and the shipped Bookings/Customers/Services/Cleaners screens — **already exists on
> `master`** (merged via PRs #78–#85). It is absent from the stale
> `fix/mobile-nav-topbar-refresh` checkout that was used for verification, which is why
> some referenced files were only found under `.claude/worktrees/*`. **Branch off
> current `master`** and they are all present.

---

## 1. Identity

An **action-first money cockpit**, not a KPI board and not a passive ledger. It leads
with a "Needs you now" triage band (the same triage DNA as Overview/Bookings),
keeps money totals as a compact inline glance (no old-style stat-tile row, per the
Customers #81 rule), surfaces the org's own Stripe balance/payout timing via the
**themed Stripe embed**, and puts the two browsable ledgers (Transactions, Payouts)
below.

User decisions locked during brainstorming:
- **Action-first cockpit** (not a metrics dashboard, not a pure ledger).
- **Org's own money = themed `ConnectPayouts` embed** on this screen (accurate
  balance + payout timing; a white-label "next payout date" can't be made reliably
  accurate — that's exactly why the white-label balance cards were deleted in commit
  `603aa8c`). Theme it with redesign tokens so the chrome feels native.
- **Triage band = failed charges + failed payouts + held payouts (awareness + nudge).**
  There is **no manual "approve payout" action** in this app — payouts settle
  automatically (`settleCleanerPayout.ts`); `pending` means a cleaner's slice is *held*
  because they haven't finished Stripe payout setup. Disputes and overdue invoices are
  **out** of triage.
- **Two ledgers only: Transactions + Payouts.** The manual **Invoices** ledger is
  dropped.

---

## 2. Architecture (locked by Phase 2 precedent)

Build in the flag-gated `(redesign)` route group, in parallel with the 100%-live legacy
app, reusing headless hooks unchanged. Legacy `src/components/PaymentsPage.tsx` and the
legacy `admin-dashboard` page are **not** edited.

### 2.1 Files to create

```
src/components/redesign/payments/
  OperatorPayments.tsx          Container: outer permission gate -> inner *Data
  OperatorPaymentsView.tsx      Pure View (props/slots only, no hooks) — dev-previewable
  derivePayments.ts             Pure filter/sort for the ledgers (no React)
  derivePayments.test.ts        Colocated Vitest
  derivePaymentsBadges.ts       Pure deriveTransactionBadge / derivePayoutBadge
  derivePaymentsBadges.test.ts  Colocated Vitest
  payments-types.ts             View-model shapes (VMs, PaymentLedger/sort unions, badge keys)
  payments-presenters.tsx       BADGE records + StatusBadge renderers + formatters
  usePaymentsTriage.ts          Focused triage data hook (its own queries + realtime)
  PaymentsTriageBand.tsx        Redesign-styled "Needs you now" band (consumes usePaymentsTriage)
  PaymentsMoneyGlance.tsx       Compact inline revenue/this-month/queued strip
  PaymentsYourMoney.tsx         Themed TenantStripeConnect embed wrapped in a redesign card
  PaymentsSegmentTabs.tsx       Transactions | Payouts pill (mirrors PeopleSegmentTabs)
  PaymentsTable.tsx             Desktop ledger table (per segment)
  PaymentsCardList.tsx          Mobile ledger cards (per segment)
  PaymentDetailSheet.tsx        Right Sheet: transaction OR payout detail + actions
  RecordPaymentDialog.tsx       Redesign Record-payment dialog (reuses /api/payments/record)

src/app/(redesign)/app/admin-dashboard/payments/page.tsx   Live route (auth + OperatorShell)
src/app/(dev)/payments-preview/page.tsx                    Dev/preview-only, mock data -> pure View

src/lib/stripe/appearance.ts   getRedesignConnectAppearance(isDark) — Stripe Connect appearance from tokens
src/lib/stripe/appearance.test.ts   Unit test asserting token values
```

Plus small additive edits (details in the relevant sections):
- `src/components/redesign/shell/nav-items.ts` — repoint the Payments nav href (§2.4).
- `src/hooks/useTenantConnect.ts` — add optional `appearanceOverride` param (§4.4).
- `src/components/TenantStripeConnect.tsx` — forward an optional `appearance` prop (§4.4).
- `src/hooks/useAdminData.ts` — widen `AdminPayment` + `AdminPayout` interfaces and add
  `cleaner_id` to the payouts select (§3, additive — data already fetched / safe).

All new components live under `src/components/redesign/payments/` (no helper modules
scattered elsewhere, except the shared `src/lib/stripe/appearance.ts`).

### 2.2 Container / View / derive split

Mirror `OperatorCustomers`:

- **`OperatorPayments`** (outer gate). Computes permissions, holds a spinner while perms
  resolve (non-privileged), renders an access-denied `EmptyState` if `!canView`, else
  mounts the inner data component. No payment data is fetched for an unauthorized viewer.
- **`OperatorPaymentsData`** (inner). Owns all hooks and all action handlers, and this
  exact UI state:
  ```ts
  search: string                       // ledger search box
  ledger: PaymentLedger                // 'transactions' | 'payouts' (URL ?ledger=)
  sort: PaymentSort                    // 'recent' | 'amount'
  statusFilter: string                 // 'all' | <segment-specific status>
  selectedRowId: string | null         // drives the detail Sheet (state, not URL)
  recordOpen: boolean                  // Record-payment dialog
  ```
  Derives ledger rows with `derivePayments(...)` in `useMemo`. Passes pure props +
  callbacks, plus the two non-pure **slots** (`triage`, `yourMoney`), to the View.
- **`OperatorPaymentsView`** (pure). Zero hooks, zero fetches. Renders header, the
  `triage` slot, money glance, the `yourMoney` slot, segment tabs, the active ledger
  table/cards, and the detail Sheet. Wrapped in `<div className="max-w-[1700px]
  space-y-6">`.
- **`derivePayments` / `derivePaymentsBadges`** — pure, React-free, generic over a
  minimal structural row type, each with a colocated Vitest spec.

**Slot boundary (resolved):** the View is pure for the dev preview. The **triage band**
and the **Your money embed** carry their own hooks/queries, so they cannot be inside the
pure View — the container renders the real `<PaymentsTriageBand/>` and
`<PaymentsYourMoney/>` and passes them as `triage?: ReactNode` / `yourMoney?: ReactNode`
slot props; the dev preview passes static mock markup. The **ledger rows and the detail
Sheet are pure** (data + callbacks only); the Sheet is rendered inside the View and
controlled by the `selectedRowId` prop + an `onCloseRow` callback (state-driven, no URL
routing — matches `BookingDetailSheet`).

### 2.3 Route + flag gate

- Live route: `src/app/(redesign)/app/admin-dashboard/payments/page.tsx` — copy the
  Customers route page verbatim, swapping in `<OperatorPayments/>` and
  `active="payments"`. (`"use client"`, Suspense, auth redirect to `/login`,
  `WorkspaceErrorScreen` on org error, then `OperatorShell`.)
- `(redesign)/layout.tsx` already 404s in prod unless `redesignUiEnabled()`
  (`NEXT_PUBLIC_REDESIGN_ENABLED === "true"`) and applies `.redesign font-jakarta`. No
  change needed.
- Dev preview: `src/app/(dev)/payments-preview/page.tsx` feeds mock arrays + mock slot
  nodes to the pure `OperatorPaymentsView` (no auth/hooks) for no-login Playwright
  iteration.

### 2.4 Nav repoint

`src/components/redesign/shell/nav-items.ts` — the Payments item is currently:
```ts
{ id: "payments", label: "Payments & payouts", href: "/admin-dashboard?tab=payments", icon: CreditCard }
```
Repoint to `href: "/app/admin-dashboard/payments"`. `OperatorShell.deriveActive` uses
longest-prefix matching, so this nests correctly. Flip it in this PR so the rail points
at the new screen once it ships.

---

## 3. Data contracts (verified)

All amounts are **dollars** (`numeric(10,2)`, rendered via `.toFixed(2)`), **not cents**.

> **Additive type widening (do this in `useAdminData.ts`).** The live hooks already
> `.select()` more columns than their TS interfaces declare, and the DB carries more
> status values than the interfaces list. Widen the interfaces to match (purely
> additive — the SELECTs already fetch the data; legacy `PaymentsPage` keeps working):
> - `AdminPayment.status` → add `'processing'` (ACH-in-transit). Add
>   `payment_type?: string; payment_method?: string; reference?: string;` (all already
>   selected).
> - `AdminPayout.status` → widen to `'pending'|'approved'|'paid'|'bank_paid'|'failed'|'reversed'`.
>   Add `cleaner_id?: string;` to the interface **and** add `cleaner_id` to the payouts
>   `.select(...)` string (currently omitted).

### 3.1 `useAdminPayments()` — Transactions ledger
Returns `{ payments: AdminPayment[], loading, error, refetch }`. Working shape (after
the widening above):
```ts
{
  id: string;
  amount: number;                 // dollars
  status: 'pending'|'processing'|'paid'|'failed'|'refunded';
  payment_type?: string;          // 'revenue' | 'expense' | 'refund'
  payment_method?: string;        // 'card' | 'ach' | 'manual'
  reference?: string;
  notes?: string;
  paid_at?: string;
  created_at: string;
  is_self_pay?: boolean;          // true => org paid; no homeowner
  appointment: {
    scheduled_date: string;
    homeowner: { first_name: string; last_name: string } | null;
    service_type: { name: string } | null;
  } | null;
}
```
Query: table `payments`, `organization_id = orgId`, joins appointment→homeowner +
service_type, order `created_at DESC`. Realtime: `refunds:{orgId}` and `disputes:{orgId}`
channels invalidate the list + stats (free when the hook is consumed).

### 3.2 `useAdminPayouts()` — Payouts ledger
Returns `{ payouts: AdminPayout[], loading, error, refetch }`. Working shape (after the
widening above):
```ts
{
  id: string;
  amount: number;                 // dollars
  status: 'pending'|'approved'|'paid'|'bank_paid'|'failed'|'reversed';
  cleaner_id?: string;            // = cleaner_profiles.id = auth.users.id (added to select)
  approved_at?: string;
  paid_at?: string;
  created_at: string;
  notes?: string;
  cleaner: { first_name: string; last_name: string } | null;
  appointment: { scheduled_date: string; id: string } | null;
}
```
Query: table `payouts`, `organization_id = orgId`, joins cleaner→user_profiles +
appointment, order `created_at DESC`. Realtime: `payouts:{orgId}` (full refetch on
UPDATE). `cleaner_id` is used by the Payouts detail Sheet and the held-payout "Message
cleaner" nudge; the `pending` status alone already means "held due to onboarding" (no
extra Stripe fetch needed).

### 3.3 `usePaymentStats()` — money glance
Returns `{ stats: { totalRevenue, pendingPayouts, thisMonthRevenue }, loading }`, all
**dollars** (RPC `payment_stats`, fallback to 3 queries). Exact definitions:
- `totalRevenue` = Σ `amount` where `status = 'paid'` AND `payment_type = 'revenue'` AND
  `is_self_pay = false`. (Refunded/failed/processing excluded by the status filter; a
  disputed charge reversed back to `paid` re-enters the sum.)
- `thisMonthRevenue` = same, restricted to the current calendar month.
- `pendingPayouts` = Σ `amount` where payout `status = 'pending'` = money *queued*
  waiting on cleaner onboarding. **Relabel "Queued payouts"** in the glance.

### 3.4 Self-pay payer name
Tag a transaction **"Self-pay"** **iff `is_self_pay === true`** (orthogonal to status).
For the payer name: homeowner present → homeowner name; else `is_self_pay` →
`currentOrganization?.name`; else (no homeowner and not self-pay = data anomaly) → org
name fallback + a console warning.

---

## 4. Screen sections

Top→bottom inside `max-w-[1700px] space-y-6`:

### 4.1 Header
- Title **Payments** + live-count subtitle (`142 transactions · 18 payouts`, or
  `Showing N of M` while searching) — **no KPI tile row.**
- Secondary action **Record payment** (top-right), gated to `canManagePayments`, opens
  `RecordPaymentDialog`.

**`RecordPaymentDialog`** mirrors the legacy `RecordPaymentModal` two-step flow,
restyled in redesign primitives (`Dialog`, `Select`, `Input`, `Button`): step 1 pick a
customer/homeowner, step 2 pick one of that customer's appointments (filtered to
`status NOT IN ('cancelled','no_show')`), then enter amount (required), payment_method
(required: card/ach/manual), and optional payment_type/notes/reference. Submits
`POST /api/payments/record` (verified to accept `payment_type?`/`notes?`/`reference?`;
defaults `payment_type='revenue'`), creates a `paid` manual row, toasts success, and
invalidates the payments + stats keys.

### 4.2 "Needs you now" triage band (`PaymentsTriageBand` + `usePaymentsTriage`)
Redesign-styled (Card + Badge + Button), replicating the proven queries/actions of
`PaymentsNeedingAttentionSection.tsx`. The whole band hides when all visible groups are
empty; each group hides independently. **Data + state live in a focused
`usePaymentsTriage()` hook** (not the ledger hooks — the band needs fields the ledger
hooks don't carry): local `loading/charges/failedPayouts/heldPayouts/busyId/error/notice`,
imperative `reload()` after each action, and `useSupabaseRealtimeSync` on the org's
`appointments` + `payouts` UPDATEs so resolved rows fall off live. All three queries run
client-side via the anon Supabase client, `.eq('organization_id', currentOrganizationId)`,
protected by the existing org-scoped RLS on those tables (same as the legacy component).

Groups, ordered by urgency:

1. **Failed / stuck charges** — `appointments` where
   `authorization_status IN ('failed','requires_action')`, `status != 'cancelled'`, org
   scoped, joining `homeowner(first_name,last_name)`; selecting `id, scheduled_date,
   total_price, authorization_status, homeowner_id, is_self_pay`. Per row:
   - **Fix card** → opens the appointment so a working card can be put on (a blind retry
     of a declined card can't succeed). Target = the shared appointment panel
     (`useAppointmentPanel().openAppointment(id)`). **Mount `AppointmentPanelHost` in
     `OperatorShell`** so this works across redesign screens (it benefits Bookings too);
     if mounting entangles with legacy providers, fall back to a legacy deep-link
     `/admin-dashboard?tab=bookings&appt=<id>` (additive param read). Decide at build;
     prefer the shell mount.
   - **Send card link** → `POST /api/billing/card-links` (`{organization_id,
     homeowner_id}`) → shareable URL; shown only for homeowner-paid
     (`homeowner_id && !is_self_pay`).
   - **This entire group is gated by `stripeNewChargeFlowUiEnabled()`** — when the flag
     is off, the Failed/stuck-charges group (header + rows) is omitted; the Failed-payouts
     and Held-payouts groups still render.
2. **Failed payouts** — `payouts` where `status = 'failed'` AND
   `attention_dismissed_at IS NULL`, org scoped; selecting `id, amount, status,
   cleaner_id, appointment_id` + cleaner name. Per row (only when `canManagePayments`):
   - **Retry now** → `POST /api/payouts/{id}/retry` (`{organization_id}`). Handle the
     `reason === 'cleaner_slice_held'` success case with the legacy copy ("cleaner still
     needs to finish payout setup, queued…").
   - **Dismiss** → `POST /api/payouts/{id}/dismiss` (`{organization_id}`; only `failed`;
     sets `attention_dismissed_at`). **Dismissal removes the row from triage and does
     not stop the auto-retry reconciliation sweep**; a later background failure does not
     re-surface it in triage (the `attention_dismissed_at IS NULL` filter keeps it
     hidden until ops manually clears it). A successful **Retry** settles the payout, so
     it leaves `failed` and the row disappears naturally.
3. **Held payouts (awareness + nudge)** — `payouts` where `status = 'pending'`, org
   scoped; selecting `cleaner_id`, amount, cleaner name. **Group rows by cleaner** (one
   awareness row per cleaner, summed amount): `"$240 queued · Wanda hasn't finished
   payout setup"`. Action **Message cleaner** → §8. No fake "approve."

### 4.3 Money glance (`PaymentsMoneyGlance`)
Compact inline strip (not tiles): `Revenue $12,480 · This month $3,210 · Queued payouts
$640`. From `usePaymentStats`. Quiet typography (`text-muted-foreground` labels,
foreground values), not bordered stat cards. Rendered only when the screen is mounted
(which already implies `canView`, see §7).

### 4.4 Your money (`PaymentsYourMoney`)
The org's own Stripe balance + next payout + bank deposits, via the **themed embed**.
- Wrap `TenantStripeConnect` in a redesign `Card` (header "Your money · Payouts to your
  bank", subtitle from the existing `PayoutsSection` copy). The inner `ConnectPayouts`
  table is Stripe's; the chrome + theme are ours.
- **Not-yet-connected / pending / disabled states are handled inside
  `TenantStripeConnect`** (owner sees onboarding; non-owner viewer sees a "your owner is
  still setting up payments" placeholder; drift → hard-stop banner; first-load skeleton
  via `StripeFramedCard`). Reuse those branches unchanged — do **not** re-implement
  balance/onboarding UI. The redesign card simply frames whatever state the embed is in.
- **Theming.** `useTenantConnect` currently hardcodes
  `appearance:{variables:{colorPrimary:'#F7C41E'}}` (`useTenantConnect.ts:242`). Add an
  optional `appearanceOverride?: StripeConnectAppearance` param to `useTenantConnect`;
  `TenantStripeConnect` gains an optional `appearance?` prop it forwards.
  `PaymentsYourMoney` reads dark mode via `useTheme().theme === 'dark'` (next-themes,
  already in the redesign layout) and passes `getRedesignConnectAppearance(isDark)`.
  Settings omits the param → keeps the legacy yellow, so only the redesign instance is
  re-themed.
- **`src/lib/stripe/appearance.ts`** — pure, unit-tested:
  ```ts
  export function getRedesignConnectAppearance(isDark: boolean): StripeConnectAppearance {
    return { variables: {
      colorPrimary:    isDark ? '#2E62FF' : '#0150FC',  // brand-500(dark) / brand-600
      fontFamily:      'Plus Jakarta Sans, system-ui, sans-serif',
      borderRadius:    '14px',                            // --radius control
      colorBackground: isDark ? '#24211B' : '#FFFFFF',   // --card
      colorText:       isDark ? '#F5F3EF' : '#211E1A',   // --foreground
      colorDanger:     '#E5484D',
    }};
  }
  ```
  (`StripeConnectAppearance` is the appearance type accepted by
  `loadConnectAndInitialize`; import it from the Connect SDK types used in
  `useTenantConnect`.)

### 4.5 Ledgers — segment toggle Transactions | Payouts
- `PaymentsSegmentTabs` mirrors `PeopleSegmentTabs`: a 2-item pill (`rounded-pill border
  bg-muted/40 p-1`, active = `bg-card shadow-soft-sm`) with `role="tablist"` +
  `role="tab"` + `aria-selected` for accessibility (same as the shipped component). This
  is an **entity-type** split (transactions vs payouts), not a fake-lifecycle segment, so
  segmenting is correct.
- **URL persistence.** `OperatorPaymentsData` reads the segment from `useSearchParams()`
  as `?ledger=payouts` (default `'transactions'`) and writes it with
  `router.replace(qs, { scroll: false })` on change — exactly the `?view=staff`
  mechanism. Type: `type PaymentLedger = 'transactions' | 'payouts'` in
  `payments-types.ts`. The detail Sheet is **not** URL-routed (state only).
- **Toolbar.** Search is the hero (`sm:flex-1`) + a status-filter `Select` + a sort
  `Select` (`sm:shrink-0`). On mobile pair the two Selects in a `grid grid-cols-2`.
  - Transactions search: reference, notes, payer (homeowner or org name), service.
  - Payouts search: cleaner name, notes.
  - Status filter — Transactions: `all / pending / processing / paid / failed /
    refunded`; Payouts: `all / queued(pending) / paid / failed / reversed`.
  - Sort (`PaymentSort = 'recent' | 'amount'`): **Newest** (default) / **Highest amount**.
- Desktop = `PaymentsTable`, mobile = `PaymentsCardList` (responsive swap like Bookings;
  CardList is the shipped mobile pattern).
- **No bulk selection bar** (no meaningful bulk money action — refund is per-row
  owner/admin; dismiss is per-row). Omit it.
- **Pagination: none initially (YAGNI).** Load all org rows; historical volume is well
  under ~1k. If initial load ever exceeds ~2s, add `.range()` cursor paging + a "Load
  more" footer to the hooks. TanStack defaults apply (`staleTime 30s`, no extra cadence).
- Row click → `selectedRowId` → `PaymentDetailSheet`. One descriptive status badge per
  row (no pill+caption).

#### Transactions row
`date · payer (self-pay → org name, plus a "Self-pay" tag pill alongside the status
badge) · service · amount · method (card/ACH/manual) · status badge`.

#### Payouts row
`date · cleaner · amount · status badge` (Queued / Paid / Failed / Reversed).

### 4.6 Detail Sheet (`PaymentDetailSheet`)
Mirror `BookingDetailSheet`: controlled by `selectedRowId` (open when non-null) +
`onCloseRow`; header with the status badge + title (payer/cleaner) + description
(service/date); a scrollable body of `Field` label/value pairs; a `SheetFooter` of
actions. On mobile it is a bottom sheet; native back/swipe dismisses it.
- **Transaction**: amount, status, method, payer, service, scheduled date,
  created/paid timestamps, reference, notes, self-pay tag. Footer **Refund** shown only
  when `canRefund && status === 'paid' && payment_method === 'card'` (`canRefund` =
  owner/admin only — the route 403s managers; ACH refunds deferred). Refund →
  `POST /api/payments/{id}/refund` (`{organization_id, amount?, reason?}`); supports
  partial; response carries `fully_refunded` + `ledger_recorded`.
- **Payout**: amount, status, cleaner, linked appointment, created/approved/paid
  timestamps, notes. Footer by state: Failed → **Retry now** + **Dismiss**; Held
  (pending) → **Message cleaner**; Paid / Bank paid / Reversed → none.

### 4.7 States (loading / empty / error / mobile / realtime)
- **Loading.** Whole screen: while the gate's perms resolve, a centered spinner (gate).
  Triage band: a 3-row `Skeleton` while `usePaymentsTriage` loads (it self-hides when
  empty, so no "empty triage" copy). Money glance: 3 shimmer pills. Ledger: the shipped
  table/card `Skeleton`. Your money: the embed's own `StripeFramedCard` skeleton.
- **Empty.** Triage hidden entirely when nothing needs action (the cockpit "all clear"
  is simply the band's absence). Ledger empty → `EmptyState` ("No transactions yet" /
  "No payouts yet"; while searching, "No matches for '<query>'").
- **Error.** Ledger/stat hook error → a compact inline error row with a Retry that calls
  `refetch` (don't blank the screen). Triage error → a small inline error line (matches
  the legacy component). The embed surfaces its own `initError`/`drift` states.
- **Mobile.** Triage groups stack one item per full-width row (no 2-col grid). Money
  glance stacks vertically (`space-y-2`) instead of an inline dot-separated strip.
  Segment tabs stay horizontal. Ledger uses `PaymentsCardList`. Detail Sheet is a bottom
  sheet.
- **Realtime (free + imperative).** Ledgers are live via the existing hook subscriptions
  (`refunds`/`disputes`/`payouts` channels invalidate the relevant keys). The triage
  band additionally reloads imperatively after each action and on its own
  `appointments`/`payouts` realtime UPDATEs. No new realtime wiring is required.

---

## 5. Status badges (descriptive, single badge)

Follow the `deriveBookingBadge` → `BADGE` record → `<StatusBadge>` pattern in
`payments-presenters.tsx`, reusing the canonical color hierarchy: `caution`(amber) =
needs you, `critical`(red) = problem, `secondary` = settled, `default`(brand + spin) =
live, `positive`(green) = done, `info`(blue) = informational.

`deriveTransactionBadge(txn) -> key`:
| status (DB) | label | variant | icon |
|---|---|---|---|
| paid | Paid | positive | CheckCircle2 |
| processing | Clearing | info | Loader2 (spin) — ACH debit in transit |
| pending | Awaiting completion | caution | Clock |
| failed | Failed | critical | XCircle |
| refunded | Refunded | info | RotateCcw |

Self-pay is a separate small `info` pill ("Self-pay") rendered **adjacent to** the status
badge (orthogonal — a row can show both "Paid" + "Self-pay").

`derivePayoutBadge(payout) -> key`:
| status (DB) | label | variant | icon |
|---|---|---|---|
| paid / bank_paid | Paid | positive | CheckCircle2 |
| pending | Held | caution | Hourglass — cleaner hasn't finished payout setup |
| failed | Failed | critical | XCircle |
| reversed | Reversed | secondary | Undo2 |
| approved | Approved | info | Clock (legacy/transitional) |

Both derivers are pure + unit-tested. Do **not** reuse `StatusPill` (it only knows
appointment statuses).

---

## 6. Endpoints used (all existing — no new routes)

| Action | Route | Method | Body | Auth |
|---|---|---|---|---|
| Retry failed payout | `/api/payouts/{id}/retry` | POST | `{organization_id}` | owner/admin, or manager **with `can_manage_payments`** |
| Dismiss failed payout | `/api/payouts/{id}/dismiss` | POST | `{organization_id}` | owner/admin, or manager **with `can_manage_payments`** |
| Send card link | `/api/billing/card-links` | POST | `{organization_id, homeowner_id}` | owner/admin/manager (role-only) |
| Refund transaction | `/api/payments/{id}/refund` | POST | `{organization_id, amount?, reason?}` | **owner/admin ONLY** (managers 403) |
| Record payment | `/api/payments/record` | POST | `{organization_id, appointment_id, amount, payment_method, payment_type?, notes?, reference?}` | owner/admin/manager (role-only); UI gates to `canManagePayments` |

No new API routes → no new `*.integration.test.ts` required. The only server-touching
change is the additive `cleaner_id` column in the `useAdminPayouts` select (a query, not
a route).

---

## 7. Permissions (gate before fetch)

`useManagerPermissions()` returns ALL_FALSE for admins, so always check role first:
```ts
const privileged        = currentOrgRole === 'owner' || currentOrgRole === 'admin';
const canView           = privileged || !!permissions?.can_view_payments;     // mount the screen
const canManagePayments = privileged || !!permissions?.can_manage_payments;   // record, retry, dismiss, card-link
const canRefund         = privileged;                                         // refund route excludes managers
```
- **Outer gate** (`OperatorPayments`) holds a spinner until perms resolve (non-privileged),
  renders an access-denied `EmptyState` if `!canView`, else mounts `OperatorPaymentsData`.
  Payment data is an app-level grant (not RLS), so no payment hook runs for an
  unauthorized viewer.
- **No partial "list but not figures" tier.** Unlike Customers (where `can_view_payments`
  only hid a spend column), the whole Payments screen — money glance, embed, and both
  ledgers — is money. `can_view_payments` is the single gate: with it (or privileged)
  you see everything; without it you get the access-denied `EmptyState`. `can_view_payments`
  and `can_manage_payments` are independent: a viewer with view-but-not-manage sees the
  ledgers/glance/embed but the Record/Retry/Dismiss/Refund actions are hidden.

---

## 8. "Message cleaner" deep-link (held-payout nudge)

Chosen approach (no legacy edit): the container handler calls
`useStartConversation().startConversation(cleaner_id)` (server-creates/returns the
conversation), then `router.push('/admin-dashboard?tab=messages')`. The thread is
already created and visible in the legacy Messages list with full history; the triage
"$X queued" line is context, not enforced in the message view. Held payouts are deduped
by cleaner (§4.2), so one nudge per cleaner.

Optional later nicety (deferred, not required): teach the legacy `admin-dashboard` page
to read `?dm=<userId>` into its existing `initialMessageRecipientId` so the conversation
auto-selects on arrival. Skipped now to keep legacy untouched until the redesign Messages
screen exists.

---

## 9. Testing & verification

- **Unit (Vitest, colocated):** `derivePayments.test.ts` (search filter + sort +
  no-mutation, per segment), `derivePaymentsBadges.test.ts` (every status → expected
  badge key/variant, both derivers), `appearance.test.ts` (token values).
- **No new integration tests** (no new API routes).
- **Playwright MCP** against the dev build (port 3100 worktree, dev Supabase) as admin:
  seed a failed payout / held payout / failed-auth appointment, then verify the triage
  band + its actions, the money glance, the **themed** embed (brand color applied), both
  ledgers + filters/sort + segment URL persistence, the detail Sheets, and
  Record/Refund. Also verify the manager-without-`can_view_payments` access-denied gate.
  Iterate to seamless per the `ui-ux-pro-max` + native-feel rules.
- Run `npm run test` + `npx tsc --noEmit` + `npm run lint`, then the Codex pre-push
  review (`/codex:review --scope branch --base master --wait`), apply valid findings as
  a follow-up commit, then push + PR.

Pre-existing repo-wide tsc noise to ignore when triaging your own output: CVA
`variant`-prop widening to `string` on Button/Badge in every redesign file (tsc is
`continue-on-error` in CI).

---

## 10. Deferred (flagged, not silently dropped)

- **Invoices ledger** (user cut it) — legacy invoices UI stays in the legacy screen.
- **In-app dispute resolution** (G10) — disputes are not in triage; handling stays in
  Stripe/legacy.
- **ACH refunds** — Refund footer is card-only (matches legacy); ACH refund is a later
  consideration.
- **Bulk money actions** — no bulk bar (no meaningful bulk operation).
- **Ledger pagination** — load-all now; cursor paging only if volume demands it.
- **`?dm=` messaging auto-select** — deep-link to legacy Messages until the redesign
  Messages screen ships.

---

## 11. Build env reminders (fresh worktree)

A new `git worktree` does **not** share `node_modules`: run `npm install` in it, copy
`.env.development.local` from the main tree (untracked), and run `next dev -p 3100` for
the Playwright pass. Content anchored-left at 1700px; money in dollars; descriptive
single badges; Codex pre-push; Playwright-verify.
