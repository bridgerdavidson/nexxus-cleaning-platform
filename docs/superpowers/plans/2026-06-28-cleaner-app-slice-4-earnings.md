# Cleaner App Slice 4: Earnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cleaner Earnings tab placeholder with a phone-first screen where Stripe's embedded payouts table owns every money number, plus a "Still clearing" list (jobs whose customer payment has not reached Stripe yet) and three activity counts.

**Architecture:** Mirror the redesign cleaner convention exactly: `page.tsx` (1-line server wrapper) -> `CleanerEarnings` (Container, all fetching + React state) -> `CleanerEarningsView` (pure presentational) -> `deriveEarnings` (pure, React-free, unit-tested) + `earnings-types.ts`. The Stripe embed (`CleanerStripeConnect`) is mounted once in a fixed slot with a latching reveal flag so the iframe never unmounts. Reuse everything: no new data layer, no new API routes, no migration.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5, Vitest, `@stripe/react-connect-js` embedded Connect components.

## Global Constraints

- **Feature flag:** the whole `(redesign)` tree is `notFound()`-gated in `src/app/(redesign)/layout.tsx` via `redesignUiEnabled()` (`NEXT_PUBLIC_REDESIGN_ENABLED==='true'`; preview/dev always allowed). The Earnings screen does NOT re-check the flag.
- **Stripe owns money:** never render `useCleanerStats.totalEarnings` / `pendingPayouts` or any of our own money aggregates. The only money figure we contribute is the cleaner's `cleanerCut` on "Still clearing" rows.
- **Dollars, not cents:** `CleanerStats` totals, `AwaitingPaymentRow.cleanerCut`, and `money2`'s input are all whole dollars. Apply `tabular-nums` to every money figure.
- **No em dashes** anywhere in UI copy (use a period, comma, parentheses, or "to").
- **Cleaner-facing copy says "office," never "operator."**
- **Never unmount the Stripe embed once painted** and **the reveal flag must LATCH** (see Task 5). Re-parenting or re-mounting the iframe reproduces the "Select an account for payouts" prod incident.
- **`deriveEarnings.ts` and its test must stay React-free** (no import of any `.tsx`, including `payments-presenters.tsx`). Money/date formatting happens in the View only.
- **Design system only:** build from `src/components/ui/*` + tokens (`bg-card`, `text-foreground`, `text-muted-foreground`, `brand-600`, `rounded-card`, etc.). No raw hex, no mockup carryover, status via the Badge vocabulary.
- Path alias `@/*` -> `./src/*`.
- All git commands run inside the worktree `C:\Builds\NexxusCleaningSolutions\.claude\worktrees\redesign-cleaner-app-slice4` (the branch `feat/redesign-cleaner-app-slice4` is checked out there). Type-check with `npx tsc --noEmit`; unit tests with `npm run test:unit`.

---

### Task 1: Add `paymentMethod` to awaiting rows + flag the privacy-unsafe payouts hook

**Files:**
- Modify: `src/hooks/useCleanerData.ts` (the `useCleanerAwaitingPayments` select + `AwaitingPaymentRow` interface + row mapping; and a comment on `useCleanerPayouts`)

**Interfaces:**
- Produces: `AwaitingPaymentRow.paymentMethod: string | null` (consumed by Task 2's `deriveEarnings` to pick ACH-vs-card settle copy).

- [ ] **Step 1: Add `payment_method` to the awaiting select.** Open `useCleanerAwaitingPayments`. In its Supabase `.select(...)` string, add `payment_method` to the top-level `payments` columns (next to `processing_fee_cents`). The string starts:

```
id, amount, processing_fee_cents, payment_method, is_self_pay, created_at,
```

- [ ] **Step 2: Add the field to `AwaitingPaymentRow`.** In the `AwaitingPaymentRow` interface add:

```ts
paymentMethod: string | null;
```

- [ ] **Step 3: Map it in the row builder.** In the object that builds each `AwaitingPaymentRow` (where `cleanerCut`, `createdAt`, `appointment` are set), add:

```ts
paymentMethod: (row.payment_method as string | null) ?? null,
```

(If `row` is strongly typed and lacks `payment_method`, read it as `(row as { payment_method?: string | null }).payment_method ?? null`.)

- [ ] **Step 4: Flag `useCleanerPayouts` as privacy-unsafe.** Directly above the `export function useCleanerPayouts(` declaration, add:

```ts
// privacy-unsafe: selects the full customer charge (payments.amount) joined with the
// homeowner name and has no payment_type filter. Do NOT render its rows to a cleaner
// (would leak the customer charge to a payout_only org). Dead code kept only because
// keys.payouts.byCleaner is invalidated elsewhere. See Slice 4 spec section 5.
```

Do NOT delete `useCleanerPayouts` or `keys.payouts.byCleaner` (the key is invalidated by `useCleanerAwaitingPayments`'s realtime sub).

- [ ] **Step 5: Type-check.**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `useCleanerData.ts`.

- [ ] **Step 6: Commit.**

```bash
git add src/hooks/useCleanerData.ts
git commit -m "feat(cleaner-earnings): add paymentMethod to awaiting rows + flag unsafe payouts hook"
```

---

### Task 2: `earnings-types.ts` + `deriveEarnings` (pure, TDD)

**Files:**
- Create: `src/components/redesign/cleaner/earnings/earnings-types.ts`
- Create: `src/components/redesign/cleaner/earnings/deriveEarnings.ts`
- Test: `src/components/redesign/cleaner/earnings/deriveEarnings.test.ts`

**Interfaces:**
- Consumes: `AwaitingPaymentRow` (incl. `paymentMethod` from Task 1) and `CleanerStats` from `@/hooks/useCleanerData`; `CleanerPayoutModel` from `@/components/redesign/cleaner/today/today-types`.
- Produces: `deriveEarnings(input: DeriveEarningsInput): EarningsData`, `shouldReveal(prev: boolean, connectKind: ConnectKind): boolean` (the latching reveal helper, consumed by Task 5's Container), and the `EarningsData` / `ClearingRow` / `ActivityCounts` / `ConnectKind` / `EarningsMode` / `ClearingSettleKind` types (consumed by Tasks 4 and 5).

- [ ] **Step 1: Create the types file.**

```ts
// src/components/redesign/cleaner/earnings/earnings-types.ts
import type { AwaitingPaymentRow, CleanerStats } from "@/hooks/useCleanerData";
import type { CleanerPayoutModel } from "@/components/redesign/cleaner/today/today-types";

/** Mirrors cleanerStatusKind()'s output (computed in the Container). */
export type ConnectKind = "loading" | "inactive" | "pending" | "active";

/** Top-level screen mode. "connect" covers every Stripe-enabled contractor state. */
export type EarningsMode = "stripe-disabled" | "employee" | "connect";

export type ClearingSettleKind = "ach" | "card" | "unknown";

export interface ClearingRow {
  id: string;
  appointmentId: string | null;
  serviceLabel: string;
  customerLabel: string;
  /** scheduledDate when present, else createdAt; formatted in the View. */
  dateRaw: string | null;
  /** The cleaner's own cut, in whole dollars (privacy-safe). */
  cutDollars: number;
  settleKind: ClearingSettleKind;
}

export interface ActivityCounts {
  thisWeek: number;
  completed: number;
  upcoming: number;
}

export interface EarningsData {
  mode: EarningsMode;
  connectKind: ConnectKind;
  clearing: ClearingRow[];
  counts: ActivityCounts;
}

export interface DeriveEarningsInput {
  stripeEnabled: boolean;
  payoutModel: CleanerPayoutModel;
  connectKind: ConnectKind;
  awaiting: AwaitingPaymentRow[] | undefined;
  stats: CleanerStats | undefined;
}
```

- [ ] **Step 2: Write the failing test.**

```ts
// src/components/redesign/cleaner/earnings/deriveEarnings.test.ts
import { describe, it, expect } from "vitest";
import { deriveEarnings, shouldReveal } from "./deriveEarnings";
import type { DeriveEarningsInput } from "./earnings-types";
import type { AwaitingPaymentRow, CleanerStats } from "@/hooks/useCleanerData";

function awaiting(over: Partial<AwaitingPaymentRow> = {}): AwaitingPaymentRow {
  return {
    id: "pay_1",
    cleanerCut: 84,
    createdAt: "2026-06-26T10:00:00.000Z",
    paymentMethod: "ach",
    appointment: {
      id: "appt_1",
      scheduledDate: "2026-06-27",
      homeownerName: "Sarah M.",
      serviceName: "Deep clean",
    },
    ...over,
  };
}

function stats(over: Partial<CleanerStats> = {}): CleanerStats {
  return {
    totalJobs: 150,
    completedThisWeek: 6,
    totalEarnings: 5240,
    pendingPayouts: 420,
    completedJobs: 142,
    upcomingJobs: 3,
    ...over,
  };
}

function input(over: Partial<DeriveEarningsInput> = {}): DeriveEarningsInput {
  return {
    stripeEnabled: true,
    payoutModel: "percentage_contractor",
    connectKind: "active",
    awaiting: [awaiting()],
    stats: stats(),
    ...over,
  };
}

describe("deriveEarnings", () => {
  it("resolves employee mode for hourly_external even when Stripe is enabled", () => {
    expect(deriveEarnings(input({ payoutModel: "hourly_external" })).mode).toBe("employee");
  });

  it("resolves stripe-disabled when Stripe is off (and not employee)", () => {
    expect(deriveEarnings(input({ stripeEnabled: false })).mode).toBe("stripe-disabled");
  });

  it("resolves connect mode otherwise and passes connectKind through", () => {
    expect(deriveEarnings(input({ connectKind: "pending" }))).toMatchObject({
      mode: "connect",
      connectKind: "pending",
    });
  });

  it("maps a clearing row with ACH settle kind and prefers scheduledDate", () => {
    const row = deriveEarnings(input()).clearing[0];
    expect(row).toEqual({
      id: "pay_1",
      appointmentId: "appt_1",
      serviceLabel: "Deep clean",
      customerLabel: "Sarah M.",
      dateRaw: "2026-06-27",
      cutDollars: 84,
      settleKind: "ach",
    });
  });

  it("classifies card and unknown settle kinds and falls back to createdAt + labels", () => {
    const cardRow = deriveEarnings(
      input({ awaiting: [awaiting({ paymentMethod: "card" })] }),
    ).clearing[0];
    expect(cardRow.settleKind).toBe("card");

    const bare = deriveEarnings(
      input({
        awaiting: [awaiting({ paymentMethod: null, appointment: null })],
      }),
    ).clearing[0];
    expect(bare.settleKind).toBe("unknown");
    expect(bare.serviceLabel).toBe("Cleaning");
    expect(bare.customerLabel).toBe("Customer");
    expect(bare.dateRaw).toBe("2026-06-26T10:00:00.000Z");
  });

  it("reads activity counts from stats and zeroes them when stats is undefined", () => {
    expect(deriveEarnings(input()).counts).toEqual({ thisWeek: 6, completed: 142, upcoming: 3 });
    expect(deriveEarnings(input({ stats: undefined })).counts).toEqual({
      thisWeek: 0,
      completed: 0,
      upcoming: 0,
    });
  });

  it("never leaks a money aggregate into the view-model", () => {
    const result = deriveEarnings(input());
    expect(Object.keys(result).sort()).toEqual(["clearing", "connectKind", "counts", "mode"]);
    const json = JSON.stringify(result);
    expect(json).not.toContain("totalEarnings");
    expect(json).not.toContain("pendingPayouts");
    expect(json).not.toContain("5240");
    expect(json).not.toContain("420");
  });
});

describe("shouldReveal (latching reveal)", () => {
  it("latches true on active and never returns to false", () => {
    expect(shouldReveal(false, "active")).toBe(true);
    expect(shouldReveal(true, "inactive")).toBe(true);
    expect(shouldReveal(true, "pending")).toBe(true);
  });

  it("stays false for non-active kinds until the user reveals it", () => {
    expect(shouldReveal(false, "inactive")).toBe(false);
    expect(shouldReveal(false, "pending")).toBe(false);
    expect(shouldReveal(false, "loading")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `npm run test:unit -- deriveEarnings`
Expected: FAIL with "deriveEarnings is not a function" / cannot find module `./deriveEarnings`.

- [ ] **Step 4: Implement `deriveEarnings`.**

```ts
// src/components/redesign/cleaner/earnings/deriveEarnings.ts
// React-free: no imports from any .tsx. Formatting happens in the View.
import type { AwaitingPaymentRow } from "@/hooks/useCleanerData";
import type {
  ClearingRow,
  ClearingSettleKind,
  ConnectKind,
  DeriveEarningsInput,
  EarningsData,
} from "./earnings-types";

function settleKindFromMethod(method: string | null | undefined): ClearingSettleKind {
  if (method === "ach" || method === "us_bank_account") return "ach";
  if (method === "card") return "card";
  return "unknown";
}

function toClearingRow(row: AwaitingPaymentRow): ClearingRow {
  return {
    id: row.id,
    appointmentId: row.appointment?.id ?? null,
    serviceLabel: row.appointment?.serviceName ?? "Cleaning",
    customerLabel: row.appointment?.homeownerName ?? "Customer",
    dateRaw: row.appointment?.scheduledDate ?? row.createdAt ?? null,
    cutDollars: row.cleanerCut ?? 0,
    settleKind: settleKindFromMethod(row.paymentMethod),
  };
}

export function deriveEarnings(input: DeriveEarningsInput): EarningsData {
  const { stripeEnabled, payoutModel, connectKind, awaiting, stats } = input;

  let mode: EarningsData["mode"];
  if (payoutModel === "hourly_external") mode = "employee";
  else if (!stripeEnabled) mode = "stripe-disabled";
  else mode = "connect";

  return {
    mode,
    connectKind,
    clearing: (awaiting ?? []).map(toClearingRow),
    counts: {
      thisWeek: stats?.completedThisWeek ?? 0,
      completed: stats?.completedJobs ?? 0,
      upcoming: stats?.upcomingJobs ?? 0,
    },
  };
}

/**
 * Latching reveal: once true it stays true. The Container calls this in an effect so a
 * post-activation Stripe restriction (connectKind leaving 'active') can never unmount a
 * live embed. NEVER recompute reveal as `clicked || kind === 'active'` without the prev.
 */
export function shouldReveal(prev: boolean, connectKind: ConnectKind): boolean {
  return prev || connectKind === "active";
}
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `npm run test:unit -- deriveEarnings`
Expected: PASS (9 tests: 7 deriveEarnings + 2 shouldReveal).

- [ ] **Step 6: Type-check.**

Run: `npx tsc --noEmit`
Expected: no new errors in the `earnings/` folder.

- [ ] **Step 7: Commit.**

```bash
git add src/components/redesign/cleaner/earnings/earnings-types.ts src/components/redesign/cleaner/earnings/deriveEarnings.ts src/components/redesign/cleaner/earnings/deriveEarnings.test.ts
git commit -m "feat(cleaner-earnings): earnings-types + deriveEarnings (pure, tested)"
```

---

### Task 3: Thread brand appearance through the cleaner Stripe embed

**Files:**
- Modify: `src/hooks/useCleanerConnect.ts` (add optional `appearanceOverride` param)
- Modify: `src/components/CleanerStripeConnect.tsx` (add optional `appearance` prop, forward it)

**Interfaces:**
- Produces: `CleanerStripeConnect` now accepts `appearance?: Parameters<typeof useCleanerConnect>[0]` (consumed by Task 5's Container, which passes `getRedesignConnectAppearance(...)`).

- [ ] **Step 1: Add the param to `useCleanerConnect`.** Change the signature from `export function useCleanerConnect(): CleanerConnectState {` to:

```ts
export function useCleanerConnect(
  appearanceOverride?: Parameters<typeof loadConnectAndInitialize>[0]["appearance"],
): CleanerConnectState {
```

- [ ] **Step 2: Use it at init (only).** In the `loadConnectAndInitialize({...})` call, replace the hardcoded appearance:

```ts
        appearance: appearanceOverride ?? {
          // Legacy fallback for callers that pass nothing (brand yellow).
          variables: { colorPrimary: '#F7C41E' },
        },
```

- [ ] **Step 3: Do NOT add it to the effect deps.** Leave the effect dependency array as `[enabled, user?.id]` and add a comment above the effect:

```ts
  // NOTE: appearanceOverride is intentionally NOT in the deps below. It is consumed
  // once at loadConnectAndInitialize time; re-running the effect would re-create the
  // Connect instance and tear down any in-flight bank-link popup (window.opener dies).
```

- [ ] **Step 4: Add the prop to `CleanerStripeConnect`.** Change `export default function CleanerStripeConnect() {` to:

```ts
export default function CleanerStripeConnect({
  appearance,
}: {
  /** Optional Stripe Connect appearance override (redesign passes brand tokens). */
  appearance?: Parameters<typeof useCleanerConnect>[0];
} = {}) {
```

- [ ] **Step 5: Forward it.** Change `const { enabled, connectInstance, initError, loading } = useCleanerConnect();` to:

```ts
  const { enabled, connectInstance, initError, loading } = useCleanerConnect(appearance);
```

- [ ] **Step 6: Type-check.**

Run: `npx tsc --noEmit`
Expected: no new errors. Existing callers of `CleanerStripeConnect` (no args) and `useCleanerConnect` (no args) still type-check because both params are optional.

- [ ] **Step 7: Commit.**

```bash
git add src/hooks/useCleanerConnect.ts src/components/CleanerStripeConnect.tsx
git commit -m "feat(cleaner-earnings): thread brand appearance into the cleaner Stripe embed"
```

---

### Task 4: `CleanerEarningsView` (pure presentational)

**Files:**
- Create: `src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx`

**Interfaces:**
- Consumes: `EarningsData`, `ClearingRow`, `ConnectKind` from `./earnings-types`; `money2`, `TxnStatusBadge` from `@/components/redesign/payments/payments-presenters`; `formatCardDate` from `@/components/redesign/cleaner/shared/job-presenters`; `PayoutTimingNotice`; `ui/*` primitives.
- Produces: `CleanerEarningsView(props: CleanerEarningsViewProps)` and the exported `CleanerEarningsViewProps` interface (consumed by Task 5's Container). The View renders the embed it is handed via the `embed` prop; it never imports `CleanerStripeConnect` itself.

Per the redesign convention, presentational views are verified by type-check + visual review, not render tests (matching `CleanerTodayView` / `CleanerScheduleView`). The unit-tested layer is `deriveEarnings` (Task 2).

- [ ] **Step 1: Create the View.**

```tsx
// src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx
"use client";

import type { ReactNode } from "react";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PayoutTimingNotice from "@/components/PayoutTimingNotice";
import { money2, TxnStatusBadge } from "@/components/redesign/payments/payments-presenters";
import { formatCardDate } from "@/components/redesign/cleaner/shared/job-presenters";
import type { ClearingRow, ClearingSettleKind, ConnectKind, EarningsData } from "./earnings-types";

export interface CleanerEarningsViewProps {
  data: EarningsData;
  mounted: boolean;
  revealed: boolean;
  todayStr: string;
  /** The Container's <CleanerStripeConnect appearance=... /> element. Mounted only here. */
  embed: ReactNode;
  onSetup: () => void;
  onOpenStripe: () => void;
  dashboardLoading: boolean;
  openStripeError: string | null;
}

function settleCopy(kind: ClearingSettleKind): string {
  if (kind === "ach") return "Expected, about 4 business days";
  if (kind === "card") return "Expected, settling";
  return "Expected";
}

export function CleanerEarningsView({
  data,
  mounted,
  revealed,
  todayStr,
  embed,
  onSetup,
  onOpenStripe,
  dashboardLoading,
  openStripeError,
}: CleanerEarningsViewProps) {
  if (data.mode === "employee") {
    return (
      <div className="space-y-4 py-2">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Landmark className="h-8 w-8 text-muted-foreground" />
            <p className="text-base font-semibold text-foreground">Your office handles your pay</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Your hours and pay are managed by your office. Reach out to them with any pay questions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const setUp = revealed || data.connectKind === "active";

  return (
    <div className="space-y-4 py-2">
      <PayoutTimingNotice />

      <PayoutsSection
        mode={data.mode}
        connectKind={data.connectKind}
        mounted={mounted}
        revealed={revealed}
        embed={embed}
        onSetup={onSetup}
        onOpenStripe={onOpenStripe}
        dashboardLoading={dashboardLoading}
        openStripeError={openStripeError}
        hasWaiting={data.clearing.length > 0}
      />

      {data.clearing.length > 0 && (
        <ClearingSection rows={data.clearing} todayStr={todayStr} setUp={setUp} />
      )}

      <ActivityTiles counts={data.counts} />
    </div>
  );
}

function PayoutsSection({
  mode,
  connectKind,
  mounted,
  revealed,
  embed,
  onSetup,
  onOpenStripe,
  dashboardLoading,
  openStripeError,
  hasWaiting,
}: {
  mode: EarningsData["mode"];
  connectKind: ConnectKind;
  mounted: boolean;
  revealed: boolean;
  embed: ReactNode;
  onSetup: () => void;
  onOpenStripe: () => void;
  dashboardLoading: boolean;
  openStripeError: string | null;
  hasWaiting: boolean;
}) {
  if (mode === "stripe-disabled") {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Payout setup isn&apos;t available yet.
        </CardContent>
      </Card>
    );
  }

  if (!revealed) {
    if (connectKind === "loading" || !mounted) {
      return <Skeleton className="h-44 w-full rounded-card" />;
    }
    return <EarningsSetupCard kind={connectKind} onSetup={onSetup} hasWaiting={hasWaiting} />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Payouts to your bank</CardTitle>
        {connectKind === "active" && (
          <Button variant="outline" size="sm" onClick={onOpenStripe} loading={dashboardLoading}>
            Open Stripe
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {openStripeError && (
          <p className="mb-3 text-sm font-medium text-destructive">{openStripeError}</p>
        )}
        {mounted ? embed : <Skeleton className="h-40 w-full rounded-card" />}
      </CardContent>
    </Card>
  );
}

function EarningsSetupCard({
  kind,
  onSetup,
  hasWaiting,
}: {
  kind: ConnectKind;
  onSetup: () => void;
  hasWaiting: boolean;
}) {
  const pending = kind === "pending";
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <Landmark className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">
            {pending ? "Finish payout setup" : "Get paid for your work"}
          </p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {pending
              ? "You are almost there. Finish connecting your bank so we can send your payouts."
              : hasWaiting
                ? "Connect your bank account through Stripe to receive the money waiting below. Takes about 3 minutes."
                : "Connect your bank account through Stripe to receive your payouts. Takes about 3 minutes."}
          </p>
        </div>
        <Button onClick={onSetup} className="w-full">
          {pending ? "Finish setup" : "Set up payouts"}
        </Button>
        <p className="text-xs text-muted-foreground">Handled securely by Stripe.</p>
      </CardContent>
    </Card>
  );
}

function ClearingSection({
  rows,
  todayStr,
  setUp,
}: {
  rows: ClearingRow[];
  todayStr: string;
  setUp: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{setUp ? "Still clearing" : "Waiting for you"}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{r.serviceLabel}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.customerLabel}
                  {r.dateRaw ? ` · ${formatCardDate(r.dateRaw, todayStr)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <TxnStatusBadge badge="processing" />
                <span className="tabular-nums text-sm font-semibold text-foreground">
                  {money2(r.cutDollars)}
                </span>
                <span className="text-[10px] text-muted-foreground">{settleCopy(r.settleKind)}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {setUp
            ? "Moves into your Stripe payouts once the customer's payment clears."
            : "Connect your bank to receive this."}
        </p>
      </CardContent>
    </Card>
  );
}

function ActivityTiles({ counts }: { counts: EarningsData["counts"] }) {
  const tiles = [
    { label: "This week", value: counts.thisWeek },
    { label: "Completed", value: counts.completed },
    { label: "Upcoming", value: counts.upcoming },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="px-3 py-3 text-center">
            <p className="tabular-nums text-lg font-bold text-foreground">{t.value}</p>
            <p className="text-[11px] text-muted-foreground">{t.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit`
Expected: no new errors. `TxnStatusBadge badge="processing"` is used in `ClearingSection` (the "Clearing" info badge), so keep its import. If `bg-brand-50` is not a defined token, swap to an existing brand tint (e.g. `bg-brand-600/10`); if `text-destructive` is not defined, use the project's error-text token (verify against `globals.css` or a sibling component).

- [ ] **Step 3: Commit.**

```bash
git add src/components/redesign/cleaner/earnings/CleanerEarningsView.tsx
git commit -m "feat(cleaner-earnings): CleanerEarningsView (presentational, all states)"
```

---

### Task 5: `CleanerEarnings` Container + wire the page

**Files:**
- Create: `src/components/redesign/cleaner/earnings/CleanerEarnings.tsx`
- Modify: `src/app/(redesign)/app/cleaner-dashboard/earnings/page.tsx`

**Interfaces:**
- Consumes: `deriveEarnings`, `CleanerEarningsView` (Tasks 2/4); `CleanerStripeConnect` + `cleanerStatusKind` from `@/components/CleanerStripeConnect`; `useStripeConnect`, `useCleanerAwaitingPayments`, `useCleanerStats`; `getRedesignConnectAppearance`.
- Produces: `CleanerEarnings()` (rendered by the page).

- [ ] **Step 1: Create the Container.**

```tsx
// src/components/redesign/cleaner/earnings/CleanerEarnings.tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import CleanerStripeConnect, { cleanerStatusKind } from "@/components/CleanerStripeConnect";
import { useStripeConnect } from "@/hooks/useStripeConnect";
import { useCleanerAwaitingPayments, useCleanerStats } from "@/hooks/useCleanerData";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";
import { deriveEarnings, shouldReveal } from "./deriveEarnings";
import { CleanerEarningsView } from "./CleanerEarningsView";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const STRIPE_ENABLED = process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function CleanerEarnings() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { connectStatus, statusLoading, connectError, dashboardLoading, handleOpenStripeDashboard } =
    useStripeConnect();
  const { data: awaiting } = useCleanerAwaitingPayments();
  const { data: stats } = useCleanerStats();

  const connectKind = cleanerStatusKind(connectStatus, statusLoading);

  // The reveal flag LATCHES: once true it never returns to false, so a post-activation
  // Stripe restriction (onboarding_complete -> false) can never unmount a live embed.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed((prev) => shouldReveal(prev, connectKind));
  }, [connectKind]);

  const stripeEnabled = STRIPE_ENABLED && !!PUBLISHABLE_KEY;

  const data = deriveEarnings({
    stripeEnabled,
    // Slice 6 wires the real organizations.default_payout_model; contractor is the live path today.
    payoutModel: "percentage_contractor",
    connectKind,
    awaiting,
    stats,
  });

  const appearance = getRedesignConnectAppearance(resolvedTheme === "dark");
  // The embed element is created here but only placed in the DOM by the View's revealed
  // branch. Because `revealed` latches, it mounts once and never unmounts.
  const embed = <CleanerStripeConnect appearance={appearance} />;

  return (
    <CleanerEarningsView
      data={data}
      mounted={mounted}
      revealed={revealed}
      todayStr={ymd(new Date())}
      embed={embed}
      onSetup={() => setRevealed(true)}
      onOpenStripe={() => {
        void handleOpenStripeDashboard();
      }}
      dashboardLoading={dashboardLoading}
      openStripeError={connectError}
    />
  );
}
```

- [ ] **Step 2: Wire the page.** Replace the entire contents of `src/app/(redesign)/app/cleaner-dashboard/earnings/page.tsx` with:

```tsx
import { CleanerEarnings } from "@/components/redesign/cleaner/earnings/CleanerEarnings";

export default function CleanerEarningsPage() {
  return <CleanerEarnings />;
}
```

- [ ] **Step 3: Type-check + lint + unit tests.**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npm run lint`
Expected: no new errors in the `earnings/` files (fix any unused-import / a11y warnings).

Run: `npm run test:unit -- deriveEarnings`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/components/redesign/cleaner/earnings/CleanerEarnings.tsx "src/app/(redesign)/app/cleaner-dashboard/earnings/page.tsx"
git commit -m "feat(cleaner-earnings): CleanerEarnings container + wire the Earnings page"
```

---

### Task 6: Visual verification + final gates

**Files:** none (verification only; fix-ups committed if needed).

- [ ] **Step 1: Start the worktree dev server.**

Run (background): `npm run dev` from the worktree. It serves on a free port (3000 if free). `.env.development.local` points at the remote dev Supabase; log in as `cleaner@nexxus.com` / `Cleaner123!`.

- [ ] **Step 2: Visit the redesign Earnings tab and screenshot each state with Playwright MCP.** Navigate to `/app/cleaner-dashboard/earnings`. Capture: (a) connected cleaner (payouts embed + clearing + activity tiles), (b) a not-set-up cleaner (the "Get paid for your work" card), and (c) the "Still clearing" list when present. Confirm: Stripe embed renders in brand blue (not yellow), no double skeleton flash, money is `tabular-nums`, no "operator" text, no em dashes.

- [ ] **Step 3: Run `ui-ux-pro-max` at implementation.** Use the real Python 3.11 exe per the `ui-feature-workflow` skill; check the built `earnings/` files for design-system conformance (raw hex, off-system shadows, touch-target sizes, token usage). Fix any flagged leak (e.g. swap a raw color for a token), commit as a follow-up.

- [ ] **Step 4: Send Bridger the screenshots of the BUILT screen** (not the mockups) for a sanity check.

- [ ] **Step 5: Full local gates.**

Run: `npm run test`
Run: `npx tsc --noEmit`
Run: `npm run lint`
Expected: green (no new failures you introduced).

- [ ] **Step 6: Commit any fix-ups.**

```bash
git add -A
git commit -m "fix(cleaner-earnings): design-system conformance + visual fixes"
```

---

## Ship (after the plan is implemented)

Per CLAUDE.md: this is a finished feature on its own branch. Run the Codex review on the branch diff vs `master`, apply valid findings in a follow-up commit, then a whole-branch review pass, then push `feat/redesign-cleaner-app-slice4` and open a PR to `master`. No migration, so no `migrate-*` jobs. Merge when the 4 checks are green. After merge, update `docs/superpowers/cleaner-app-status.md` (mark Slice 4 done, next = Slice 5 Messages) and the project memory.
