# Operator Payments Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the redesigned operator **Payments** screen — an action-first money cockpit (triage band + inline money glance + themed Stripe embed + Transactions/Payouts ledgers) in the flag-gated `(redesign)` route group, reusing existing headless hooks.

**Architecture:** Mirror the shipped Customers/Bookings screens: an outer permission **gate** (`OperatorPayments`) wrapping an inner **Data** container (`OperatorPaymentsData`, owns hooks/state/handlers) that feeds a **pure View** (`OperatorPaymentsView`, props + `ReactNode` slots). Pure filter/sort + badge derivation live in unit-tested React-free modules. The triage band and the Stripe embed are non-pure slot components. No new API routes; only additive type/`select` widening.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (redesign tokens), TanStack Query v5, Stripe Connect embedded components, Vitest, Playwright MCP.

## Global Constraints

- Branch `feat/redesign-operator-payments` in worktree `.claude/worktrees/redesign-payments` (off `master`). Dev server: `next dev -p 3100`.
- Money is **dollars** (`numeric(10,2)`, `.toFixed(2)` / `toLocaleString`), never cents.
- **No em dashes** in any user-facing copy (UI text, labels, toasts). Use periods/commas/parentheses.
- Content anchored-left at `max-w-[1700px] space-y-6` (NOT mx-auto-centered).
- One **descriptive** status badge per row (fold status + sub-state); never a pill + caption.
- Badge variant → tone: `caution`=needs-you (amber), `critical`=problem (red), `secondary`=settled, `default`=live (brand+spin), `positive`=done (green), `info`=informational, `outline`=neutral.
- Permission gating checks **role first** (`useManagerPermissions` returns ALL_FALSE for admins): `privileged = owner|admin`; `canView = privileged || can_view_payments`; `canManagePayments = privileged || can_manage_payments`; `canRefund = privileged` (refund route 403s managers).
- Reuse headless hooks unchanged except the additive widening in Task 5. Legacy `src/components/PaymentsPage.tsx` and `src/app/admin-dashboard/page.tsx` are NOT edited.
- Imports use the `@/*` alias. Primitives from `@/components/ui/*`.
- Per task: typecheck (`npx tsc --noEmit`), run new unit tests, commit. Final gate: `npm run test` + `npx tsc --noEmit` + `npm run lint` + Codex pre-push review + Playwright verify.
- tsc noise to ignore: CVA `variant`-prop widening to `string` on Button/Badge in redesign files (pre-existing, `continue-on-error` in CI).

---

### Task 1: Types (`payments-types.ts`)

**Files:**
- Create: `src/components/redesign/payments/payments-types.ts`

**Interfaces — Produces:**
```ts
export type PaymentLedger = "transactions" | "payouts";

export type PaymentSort = "recent" | "amount";
export const PAYMENT_SORTS: { id: PaymentSort; label: string }[] = [
  { id: "recent", label: "Newest" },
  { id: "amount", label: "Highest amount" },
];

export type TxnStatusFilter = "all" | "pending" | "processing" | "paid" | "failed" | "refunded";
export type PayoutStatusFilter = "all" | "queued" | "paid" | "failed" | "reversed";

export const TXN_STATUS_FILTERS: { id: TxnStatusFilter; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "Awaiting completion" },
  { id: "processing", label: "Clearing" },
  { id: "paid", label: "Paid" },
  { id: "failed", label: "Failed" },
  { id: "refunded", label: "Refunded" },
];
export const PAYOUT_STATUS_FILTERS: { id: PayoutStatusFilter; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "queued", label: "Held" },
  { id: "paid", label: "Paid" },
  { id: "failed", label: "Failed" },
  { id: "reversed", label: "Reversed" },
];

export type TxnBadgeKey = "paid" | "processing" | "pending" | "failed" | "refunded";
export type PayoutBadgeKey = "paid" | "held" | "failed" | "reversed" | "approved";

export type TransactionRowVM = {
  id: string;
  dateLabel: string;        // "Jun 20, 2026"
  payer: string;            // homeowner name OR org name
  selfPay: boolean;
  service: string;          // service_type name or "Cleaning"
  amountLabel: string;      // "$120.00"
  method: string;           // "Card" | "ACH" | "Manual"
  badge: TxnBadgeKey;
};

export type PayoutRowVM = {
  id: string;
  dateLabel: string;
  cleaner: string;          // cleaner name or "Cleaner"
  amountLabel: string;
  badge: PayoutBadgeKey;
};

export type TransactionDetailVM = TransactionRowVM & {
  reference: string | null;
  notes: string | null;
  createdLabel: string;
  paidLabel: string | null;
  refundable: boolean;      // canRefund && status==='paid' && method card
};

export type PayoutDetailVM = PayoutRowVM & {
  cleanerId: string | null;
  appointmentId: string | null;
  notes: string | null;
  createdLabel: string;
  approvedLabel: string | null;
  paidLabel: string | null;
  rawStatus: string;        // to choose footer actions
};

export type TriageChargeVM = {
  apptId: string;
  payer: string;
  amountLabel: string;
  dateLabel: string;
  reason: "failed" | "requires_action";
  canSendLink: boolean;     // homeowner_id && !is_self_pay
};
export type TriagePayoutVM = { id: string; cleaner: string; amountLabel: string };
export type TriageHeldVM = { cleanerId: string | null; cleaner: string; amountLabel: string };
```

- [ ] **Step 1:** Create the file with the exact types above.
- [ ] **Step 2:** `npx tsc --noEmit` (expect no NEW errors from this file).
- [ ] **Step 3:** Commit: `git add src/components/redesign/payments/payments-types.ts && git commit -m "feat(payments): view-model + filter types"`

---

### Task 2: Pure filter/sort (`derivePayments.ts` + test)

**Files:**
- Create: `src/components/redesign/payments/derivePayments.ts`
- Test: `src/components/redesign/payments/derivePayments.test.ts`

**Interfaces — Consumes:** `PaymentSort`, `TxnStatusFilter`, `PayoutStatusFilter` (Task 1).
**Produces:** `deriveTransactions<T>(list, opts)`, `derivePayouts<T>(list, opts)` + helpers, mirroring `deriveBookings.ts` (React-free, generic, never mutates input).

Structural row subsets:
```ts
export type TxnLike = {
  amount: number; status: string; created_at: string; reference?: string | null;
  notes?: string | null; payment_method?: string | null; is_self_pay?: boolean;
  appointment?: { homeowner?: { first_name?: string; last_name?: string } | null;
    service_type?: { name?: string } | null } | null;
};
export type PayoutLike = {
  amount: number; status: string; created_at: string; notes?: string | null;
  cleaner?: { first_name?: string; last_name?: string } | null;
};
```
- `matchesTxnSearch(t, q, orgName)` searches reference, notes, payer (homeowner or `orgName` when self-pay), service.
- `matchesPayoutSearch(p, q)` searches cleaner name + notes.
- `matchesTxnStatus(t, f)`: `f==='all' || t.status===f`.
- `matchesPayoutStatus(p, f)`: map `queued→'pending'`, `paid→status in ('paid','bank_paid')`, else `p.status===f`.
- sort: `recent` = `created_at` desc (string compare reversed); `amount` = `amount` desc.
- `deriveTransactions(list, { search, statusFilter, sort, orgName })`, `derivePayouts(list, { search, statusFilter, sort })`.

- [ ] **Step 1: Write failing tests** covering: empty query matches all; search by payer/cleaner/reference; self-pay search matches org name; status filter (including `queued→pending` and `paid→bank_paid`); sort recent + amount; no input mutation.

```ts
import { describe, expect, it } from "vitest";
import { deriveTransactions, derivePayouts, matchesPayoutStatus, type TxnLike, type PayoutLike } from "./derivePayments";

const txn = (o: Partial<TxnLike> = {}): TxnLike => ({
  amount: 120, status: "paid", created_at: "2026-06-01T00:00:00Z",
  appointment: { homeowner: { first_name: "Alice", last_name: "Jones" }, service_type: { name: "Deep Clean" } }, ...o,
});
const payout = (o: Partial<PayoutLike> = {}): PayoutLike => ({
  amount: 80, status: "pending", created_at: "2026-06-01T00:00:00Z",
  cleaner: { first_name: "Wanda", last_name: "Cole" }, ...o,
});

describe("deriveTransactions", () => {
  it("empty query keeps all; filters by payer, reference, self-pay org name", () => {
    expect(deriveTransactions([txn()], { search: "", statusFilter: "all", sort: "recent", orgName: "Acme" })).toHaveLength(1);
    expect(deriveTransactions([txn()], { search: "alice", statusFilter: "all", sort: "recent", orgName: "Acme" })).toHaveLength(1);
    expect(deriveTransactions([txn({ reference: "AP-9" })], { search: "ap-9", statusFilter: "all", sort: "recent", orgName: "Acme" })).toHaveLength(1);
    const sp = txn({ is_self_pay: true, appointment: { homeowner: null, service_type: { name: "Clean" } } });
    expect(deriveTransactions([sp], { search: "acme", statusFilter: "all", sort: "recent", orgName: "Acme" })).toHaveLength(1);
  });
  it("status filter + sort", () => {
    const a = txn({ created_at: "2026-01-01T00:00:00Z", amount: 50 });
    const b = txn({ created_at: "2026-03-01T00:00:00Z", amount: 300, status: "failed" });
    expect(deriveTransactions([a, b], { search: "", statusFilter: "failed", sort: "recent", orgName: "x" })).toHaveLength(1);
    expect(deriveTransactions([a, b], { search: "", statusFilter: "all", sort: "recent", orgName: "x" }).map((t) => t.amount)).toEqual([300, 50]);
    expect(deriveTransactions([a, b], { search: "", statusFilter: "all", sort: "amount", orgName: "x" }).map((t) => t.amount)).toEqual([300, 50]);
  });
  it("does not mutate input", () => {
    const input = [txn({ amount: 1 }), txn({ amount: 2 })];
    deriveTransactions(input, { search: "", statusFilter: "all", sort: "amount", orgName: "x" });
    expect(input[0].amount).toBe(1);
  });
});

describe("matchesPayoutStatus", () => {
  it("queued maps to pending; paid includes bank_paid", () => {
    expect(matchesPayoutStatus(payout({ status: "pending" }), "queued")).toBe(true);
    expect(matchesPayoutStatus(payout({ status: "bank_paid" }), "paid")).toBe(true);
    expect(matchesPayoutStatus(payout({ status: "failed" }), "paid")).toBe(false);
  });
});

describe("derivePayouts", () => {
  it("search by cleaner + sort by amount", () => {
    const a = payout({ amount: 10 }); const b = payout({ amount: 90, cleaner: { first_name: "Bob", last_name: "Lee" } });
    expect(derivePayouts([a, b], { search: "bob", statusFilter: "all", sort: "recent" })).toHaveLength(1);
    expect(derivePayouts([a, b], { search: "", statusFilter: "all", sort: "amount" }).map((p) => p.amount)).toEqual([90, 10]);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/components/redesign/payments/derivePayments.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `derivePayments.ts` per the contract above.
- [ ] **Step 4:** Re-run the test → PASS.
- [ ] **Step 5:** Commit: `git add ... && git commit -m "feat(payments): pure ledger filter/sort + tests"`

---

### Task 3: Badge derivation + presenters (`derivePaymentsBadges.ts`, `payments-presenters.tsx` + test)

**Files:**
- Create: `src/components/redesign/payments/derivePaymentsBadges.ts`, `payments-presenters.tsx`
- Test: `src/components/redesign/payments/derivePaymentsBadges.test.ts`

**Interfaces — Consumes:** `TxnBadgeKey`, `PayoutBadgeKey` (Task 1), `Badge` primitive.
**Produces:** `deriveTransactionBadge(status)`, `derivePayoutBadge(status)`, `<TxnStatusBadge>`, `<PayoutStatusBadge>`, `<SelfPayTag>`.

`derivePaymentsBadges.ts`:
```ts
import type { TxnBadgeKey, PayoutBadgeKey } from "./payments-types";
export function deriveTransactionBadge(status: string): TxnBadgeKey {
  switch (status) {
    case "paid": return "paid";
    case "processing": return "processing";
    case "failed": return "failed";
    case "refunded": return "refunded";
    default: return "pending"; // 'pending' and any unknown
  }
}
export function derivePayoutBadge(status: string): PayoutBadgeKey {
  switch (status) {
    case "paid": case "bank_paid": return "paid";
    case "failed": return "failed";
    case "reversed": return "reversed";
    case "approved": return "approved";
    default: return "held"; // 'pending' = held
  }
}
```
`payments-presenters.tsx` mirrors `bookings-presenters.tsx`: a `BADGE_TXN`/`BADGE_PAYOUT` record `{label, variant, Icon, spin?}` → `<Badge variant className="shrink-0 whitespace-nowrap"><Icon/>{label}</Badge>`. Mapping:
- Txn: paid→{Paid, positive, CheckCircle2}; processing→{Clearing, info, Loader2, spin}; pending→{Awaiting completion, caution, Clock}; failed→{Failed, critical, XCircle}; refunded→{Refunded, info, RotateCcw}.
- Payout: paid→{Paid, positive, CheckCircle2}; held→{Held, caution, Hourglass}; failed→{Failed, critical, XCircle}; reversed→{Reversed, secondary, Undo2}; approved→{Approved, info, Clock}.
- `<SelfPayTag>` = `<Badge variant="info">Self-pay</Badge>`.
- Also export money/date formatters reused across components: `money2(n)`, `longDate(dateStr)`, `methodLabel(m)` (`card→"Card"`, `ach→"ACH"`, else `"Manual"`).

- [ ] **Step 1: Write failing tests** asserting each status maps to the expected key (both derivers, incl. `bank_paid→paid`, `pending→held`, unknown txn→pending).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(payments): descriptive status badges + presenters + tests"`

---

### Task 4: Stripe Connect appearance helper (`appearance.ts` + test)

**Files:**
- Create: `src/lib/stripe/appearance.ts`, `src/lib/stripe/appearance.test.ts`

**Produces:** `getRedesignConnectAppearance(isDark: boolean)`.
```ts
// Stripe Connect appearance from redesign tokens. Pure so it is unit-testable.
export function getRedesignConnectAppearance(isDark: boolean) {
  return {
    variables: {
      colorPrimary: isDark ? "#2E62FF" : "#0150FC",
      fontFamily: "Plus Jakarta Sans, system-ui, sans-serif",
      borderRadius: "14px",
      colorBackground: isDark ? "#24211B" : "#FFFFFF",
      colorText: isDark ? "#F5F3EF" : "#211E1A",
      colorDanger: "#E5484D",
    },
  } as const;
}
```
- [ ] **Step 1:** Write a test asserting light → `colorPrimary "#0150FC"` and dark → `"#2E62FF"`, fontFamily + borderRadius constant.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

---

### Task 5: Additive hook/embed widening (`useTenantConnect`, `TenantStripeConnect`, `useAdminData`)

**Files:**
- Modify: `src/hooks/useTenantConnect.ts` (add optional `appearanceOverride?` param → pass to `loadConnectAndInitialize` instead of the hardcoded yellow when provided)
- Modify: `src/components/TenantStripeConnect.tsx` (add optional `appearance?` prop, forward to `useTenantConnect(appearance)`)
- Modify: `src/hooks/useAdminData.ts` — widen `AdminPayment` (`status` += `'processing'`; add `payment_type?`, `payment_method?`, `reference?`), widen `AdminPayout` (`status` union += `'bank_paid' | 'reversed'`; add `cleaner_id?`), and add `cleaner_id` to the payouts `.select(...)` string.

**Interfaces — Produces:** themed-embed seam + the widened `AdminPayment`/`AdminPayout` types Tasks 7/12/13 consume.

- [ ] **Step 1:** Read each target's exact current code (the `loadConnectAndInitialize` call, the two interfaces, the payouts select string).
- [ ] **Step 2:** Apply the additive changes (do not change legacy default behavior when the new param/prop is omitted).
- [ ] **Step 3:** `npx tsc --noEmit` → no new errors; `npm run test` for `useAdminData`-touching suites if any.
- [ ] **Step 4:** Commit: `git commit -m "feat(payments): additive Connect appearance override + widen admin payment/payout types"`

---

### Task 6: Triage data hook (`usePaymentsTriage.ts`)

**Files:**
- Create: `src/components/redesign/payments/usePaymentsTriage.ts`

**Interfaces — Consumes:** `supabase`, `useAuth`, `useSupabaseRealtimeSync`, `getAccessToken`, `stripeNewChargeFlowUiEnabled`, `useStartConversation`, `useAppointmentPanel` (or a fallback), the triage VMs (Task 1).
**Produces:**
```ts
export function usePaymentsTriage(canManagePayments: boolean): {
  loading: boolean;
  charges: TriageChargeVM[];        // [] when flag off
  failedPayouts: TriagePayoutVM[];
  heldPayouts: TriageHeldVM[];      // grouped by cleaner, summed
  busyId: string | null;
  error: string | null;
  notice: string | null;
  reload: () => Promise<void>;
  retryPayout: (id: string) => Promise<void>;
  dismissPayout: (id: string) => Promise<void>;
  sendCardLink: (apptId: string, homeownerId: string | null) => Promise<void>;
  fixCard: (apptId: string) => void;
  messageCleaner: (cleanerId: string | null) => Promise<void>;
  isEmpty: boolean;
}
```
Behavior (replicate `PaymentsNeedingAttentionSection.tsx`):
- Three Supabase queries (charges only when `stripeNewChargeFlowUiEnabled()`): appointments `authorization_status IN ('failed','requires_action')` + `status != 'cancelled'` + homeowner join; payouts `status='failed'` + `attention_dismissed_at IS NULL`; payouts `status='pending'` selecting `cleaner_id, amount` + cleaner name. Group held by `cleaner_id`, sum amounts, label `"<Cleaner> hasn't finished payout setup"`.
- Self-pay/charge payer name: homeowner name, else org name.
- `retryPayout` → `POST /api/payouts/{id}/retry`; surface `reason==='cleaner_slice_held'` notice; `reload()` + return.
- `dismissPayout` → `POST /api/payouts/{id}/dismiss`.
- `sendCardLink` → `POST /api/billing/card-links`.
- `fixCard` → `useAppointmentPanel().openAppointment(id)` if available; else `window.location.assign('/admin-dashboard?tab=bookings')` fallback (decide at build).
- `messageCleaner` → `useStartConversation().startConversation(cleanerId)` then route to `/admin-dashboard?tab=messages`.
- Realtime: `useSupabaseRealtimeSync` on `appointments` + `payouts` (org-filtered) → `reload()`.

- [ ] **Step 1:** Read `PaymentsNeedingAttentionSection.tsx` + `useStartConversation.ts` + `useAppointmentPanel` to copy exact call shapes.
- [ ] **Step 2:** Implement the hook.
- [ ] **Step 3:** `npx tsc --noEmit` → no new errors.
- [ ] **Step 4:** Commit: `git commit -m "feat(payments): triage data hook (charges/failed/held payouts + actions)"`

> No unit test (it's IO/effect-heavy, matching the untested legacy component); verified live via Playwright in Task 14.

---

### Task 7: Triage band (`PaymentsTriageBand.tsx`)

**Files:**
- Create: `src/components/redesign/payments/PaymentsTriageBand.tsx`

Consumes `usePaymentsTriage(canManagePayments)`. Renders (redesign primitives, amber-tinted `Card`): header "Needs you now" + count; a Charges group (Fix card + Send card link buttons), a Failed-payouts group (Retry now + Dismiss, only when `canManagePayments`), a Held-payouts group (Message cleaner). Returns `null` when `isEmpty` and not loading; a 3-row `Skeleton` while loading. One item per full-width row on mobile. Icons: `AlertTriangle`, `CreditCard`, `RefreshCw`/`Loader2`, `X`, `MessageSquare`, `Hourglass`. Buttons use `Button size="sm"`.

- [ ] **Step 1:** Implement the component.
- [ ] **Step 2:** `npx tsc --noEmit`.
- [ ] **Step 3:** Commit.

---

### Task 8: Money glance (`PaymentsMoneyGlance.tsx`)

**Files:**
- Create: `src/components/redesign/payments/PaymentsMoneyGlance.tsx`

Props: `{ totalRevenue: number; thisMonth: number; queuedPayouts: number; loading?: boolean }`. Inline strip on desktop (`flex` with dot separators), stacked `space-y-2` on mobile. Quiet labels (`text-muted-foreground`) + foreground values via `money2`. 3 shimmer pills while loading. Labels: "Revenue", "This month", "Queued payouts".

- [ ] **Step 1:** Implement. **Step 2:** tsc. **Step 3:** Commit.

---

### Task 9: Your money embed (`PaymentsYourMoney.tsx`)

**Files:**
- Create: `src/components/redesign/payments/PaymentsYourMoney.tsx`

A redesign `Card` (header "Your money", subtitle "Your Stripe balance, the next payout on its way, and what's already landed in your bank.") wrapping `<TenantStripeConnect appearance={getRedesignConnectAppearance(isDark)} />`. Read `isDark` via `useTheme()` from `next-themes` (`theme === 'dark'`). All onboarding/viewer/drift/skeleton states are handled inside `TenantStripeConnect`.

- [ ] **Step 1:** Confirm `next-themes` `useTheme` is the provider used by `(redesign)/layout.tsx`. Implement. **Step 2:** tsc. **Step 3:** Commit.

---

### Task 10: Ledger table + cards + segment tabs (`PaymentsTable.tsx`, `PaymentsCardList.tsx`, `PaymentsSegmentTabs.tsx`)

**Files:**
- Create: `src/components/redesign/payments/PaymentsSegmentTabs.tsx` (reuse `@/components/ui/segmented-control` if its API fits; else mirror `PeopleSegmentTabs`) with items `[{id:'transactions',label:'Transactions'},{id:'payouts',label:'Payouts'}]`, `role=tablist`.
- Create: `src/components/redesign/payments/PaymentsTable.tsx` — desktop `Table`; branches columns by `ledger`. Transactions: Date, Payer (+ `<SelfPayTag>`), Service, Method, Amount, Status (`<TxnStatusBadge>`). Payouts: Date, Cleaner, Amount, Status (`<PayoutStatusBadge>`). `TableRow` `cursor-pointer` → `onOpenRow(id)`.
- Create: `src/components/redesign/payments/PaymentsCardList.tsx` — mobile cards, same fields.

Props: `{ ledger: PaymentLedger; txnRows: TransactionRowVM[]; payoutRows: PayoutRowVM[]; onOpenRow: (id) => void }`.

- [ ] **Step 1:** Read `segmented-control.tsx` + `CustomersTable.tsx`/`BookingsTable.tsx` for the table pattern. **Step 2:** Implement all three. **Step 3:** tsc. **Step 4:** Commit.

---

### Task 11: Detail Sheet (`PaymentDetailSheet.tsx`)

**Files:**
- Create: `src/components/redesign/payments/PaymentDetailSheet.tsx`

Mirror `CustomerDetailSheet`/`BookingDetailSheet`: controlled `open`/`onOpenChange`. Discriminated by `kind: 'transaction' | 'payout'`. Header: status badge + title (payer/cleaner) + description (service/date). Body: `Field` label/value rows. Footer:
- Transaction: **Refund** when `detail.refundable` → calls `onRefund(id)`.
- Payout: by `rawStatus` → Failed: **Retry now** + **Dismiss**; pending(held): **Message cleaner**; else none.
Props pass the action callbacks from the container.

- [ ] **Step 1:** Read `CustomerDetailSheet.tsx` for the `Field` + Sheet structure. **Step 2:** Implement. **Step 3:** tsc. **Step 4:** Commit.

---

### Task 12: Record-payment dialog (`RecordPaymentDialog.tsx`)

**Files:**
- Create: `src/components/redesign/payments/RecordPaymentDialog.tsx`

Two-step (customer → their appointment) restyle of the legacy `RecordPaymentModal`, using `Dialog`, `Select`, `Input`, `Textarea`, `Button`. Fields: appointment (required, filtered to `status NOT IN ('cancelled','no_show')`), amount (required), method (required: card/ach/manual), optional payment_type/notes/reference. Submits `POST /api/payments/record`; on success toast + `onRecorded()` (container invalidates). Reuse the legacy appointment-source query (homeowner list + their appointments).

- [ ] **Step 1:** Read `RecordPaymentModal.tsx` for the appointment-source query + field set. **Step 2:** Implement. **Step 3:** tsc. **Step 4:** Commit.

---

### Task 13: Pure View (`OperatorPaymentsView.tsx`)

**Files:**
- Create: `src/components/redesign/payments/OperatorPaymentsView.tsx`

Pure (no hooks). Props:
```ts
{
  loading?: boolean;
  ledger: PaymentLedger; onLedgerChange: (l: PaymentLedger) => void;
  txnRows: TransactionRowVM[]; payoutRows: PayoutRowVM[];
  txnTotal: number; payoutTotal: number;
  search: string; onSearchChange: (v: string) => void;
  sort: PaymentSort; onSortChange: (v: PaymentSort) => void;
  statusFilter: string; onStatusFilterChange: (v: string) => void;
  onOpenRow: (id: string) => void;
  canManagePayments: boolean; onRecordPayment?: () => void;
  triage?: React.ReactNode;     // slot
  moneyGlance?: React.ReactNode; // slot
  yourMoney?: React.ReactNode;  // slot
}
```
Layout (top→bottom in `max-w-[1700px] space-y-6`): header (title "Payments" + live-count subtitle `N transactions · M payouts`, Record-payment button when `canManagePayments && onRecordPayment`); `{triage}`; `{moneyGlance}`; `{yourMoney}`; segment tabs; toolbar (search hero + status filter `Select` + sort `Select`, mobile `grid grid-cols-2`); the active ledger table/cards (`hidden lg:block` / `lg:hidden`); `EmptyState` when the active list is empty. Status-filter options switch on `ledger`.

- [ ] **Step 1:** Implement (mirror `OperatorCustomersView`). **Step 2:** tsc. **Step 3:** Commit.

---

### Task 14: Container + gate (`OperatorPayments.tsx`)

**Files:**
- Create: `src/components/redesign/payments/OperatorPayments.tsx`

Outer `OperatorPayments` gate (copy the `OperatorCustomers` gate; `canView = privileged || can_view_payments`). Inner `OperatorPaymentsData`:
- Hooks: `useAdminPayments`, `useAdminPayouts`, `usePaymentStats`, `useAuth` (`currentOrganization` for org name + self-pay payer), `useToast`.
- State: `search`, `ledger` (from `?ledger=` via `useSearchParams`/`router.replace`), `sort`, `statusFilter` (reset to `'all'` on ledger change), `selectedRowId`, `recordOpen`.
- Derive `txnRows`/`payoutRows` via `deriveTransactions`/`derivePayouts` + the `toRowVM` mappers (using `money2`, `longDate`, `methodLabel`, badges, self-pay/org-name payer).
- Build detail VM from the selected row's source record (incl. `refundable = canRefund && status==='paid' && method==='card'`).
- Handlers: `refundTxn` (`POST /api/payments/{id}/refund` then `refetch`), `retryPayout`/`dismissPayout` (reuse the triage hook's endpoints or inline), `messageCleaner` (`useStartConversation` + route).
- Renders `<OperatorPaymentsView>` with the three slots: `<PaymentsTriageBand canManagePayments={...}/>`, `<PaymentsMoneyGlance .../>`, `<PaymentsYourMoney/>` (only when `canView`), plus `<PaymentDetailSheet>` and `<RecordPaymentDialog>`.

- [ ] **Step 1:** Implement. **Step 2:** tsc. **Step 3:** Commit.

---

### Task 15: Route page + dev preview + nav repoint

**Files:**
- Create: `src/app/(redesign)/app/admin-dashboard/payments/page.tsx` (copy the customers route page; swap `OperatorPayments` + `active="payments"`).
- Create: `src/app/(dev)/payments-preview/page.tsx` (mock `txnRows`/`payoutRows` + static mock slot nodes → pure `OperatorPaymentsView`, inside `OperatorShell`).
- Modify: `src/components/redesign/shell/nav-items.ts` — Payments `href` → `/app/admin-dashboard/payments`.

- [ ] **Step 1:** Read the customers route page + a preview page + `nav-items.ts`. **Step 2:** Implement all three. **Step 3:** tsc. **Step 4:** Commit.

---

### Task 16: Verify, gates, review

- [ ] **Step 1:** `next dev -p 3100`; Playwright MCP as admin (dev Supabase): open `/app/admin-dashboard/payments` — verify triage band + actions, money glance, themed embed (brand color), both ledgers + filters/sort + `?ledger=` persistence, detail sheets, Record/Refund. Open `/payments-preview` for the pure-View states. Verify the manager-without-`can_view_payments` access-denied gate. Iterate to seamless.
- [ ] **Step 2:** `npm run test` + `npx tsc --noEmit` + `npm run lint` (ignore pre-existing noise).
- [ ] **Step 3:** Commit any fixes. Run Codex pre-push review (`/codex:review --scope branch --base master --wait`); apply valid findings as a follow-up commit.
- [ ] **Step 4:** Push `feat/redesign-operator-payments`; open PR to `master`.

---

## Self-Review

- **Spec coverage:** §2 files → Tasks 1–15; §3 data contract → Task 5 (widening) + Tasks 2/3/14 (consumption); §4.1 header/Record → Tasks 12/13; §4.2 triage → Tasks 6/7; §4.3 glance → Task 8; §4.4 your-money/theming → Tasks 4/5/9; §4.5 ledgers/segment → Tasks 1/2/10/13; §4.6 sheet → Task 11; §4.7 states → Tasks 7/8/13 (skeletons, empty, mobile) + hook realtime (Task 6); §5 badges → Task 3; §6 endpoints → Tasks 6/11/12/14; §7 permissions → Tasks 14; §8 message-cleaner → Tasks 6/14; §9 tests → Tasks 2/3/4 + Task 16. No gaps.
- **Placeholder scan:** the only "decide at build" is the `fixCard` panel-vs-deeplink fallback (Task 6) and the segmented-control-vs-PeopleSegmentTabs choice (Task 10), both with a concrete default. No TODOs.
- **Type consistency:** VM names (`TransactionRowVM`, `PayoutRowVM`, badge keys, `PaymentLedger`, `PaymentSort`) defined in Task 1 and consumed unchanged in Tasks 2/3/10/11/13/14. `deriveTransactions`/`derivePayouts` signatures match between Task 2 and Task 14.
