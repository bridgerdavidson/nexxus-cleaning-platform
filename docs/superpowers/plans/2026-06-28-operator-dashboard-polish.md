# Operator Dashboard Polish, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six on-system polish fixes across the redesigned operator dashboard (toolbars, FAB, message thread, Services cards, Payments KPIs + pagination, Settings avatar) in one flag-gated PR.

**Architecture:** All work lives under `src/components/redesign/**`, `src/app/(redesign)/**`, plus two shared helpers in `src/lib/**`, behind `NEXT_PUBLIC_REDESIGN_ENABLED`. Pure logic (pagination math, initials, KPI item builder) is TDD'd as co-located `*.test.ts`. Presentational changes are built from the design system and verified with Playwright MCP at 375px + desktop plus a conformance grep, which is the established test cycle for redesign screens (unit-testing JSX classes adds nothing).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, TanStack Query v5 (introducing `useInfiniteQuery`), Supabase JS, Vitest, Playwright.

## Global Constraints

- Redesign-only: changes confined to `src/components/redesign/**`, `src/app/(redesign)/**`, `src/lib/**`. Legacy operator UI and the shared `useAdminPayments`/`useAdminPayouts` hooks stay untouched (they feed the legacy `admin-dashboard`/`manager-dashboard` pages).
- Design system is the styling source: `src/components/ui/*` primitives + tokens (`tailwind.config.js`, `src/app/globals.css`). Brand `#0150FC` via tokens (`brand-600`, `bg-brand-600`). **Never** `primary`/`#F7C41E`/`bg-primary-*`/`text-primary-*`/`rgba(217,167,24,*)`, **never** raw hex, **never** a mockup carryover.
- Reuse primitives first: `StatTile`, `Button`, `Input`, `Select`, `Card`, `Avatar`, `Sheet`, `Skeleton`, `EmptyState`, `SegmentedControl`, `ChevronRight`.
- Touch targets >= 44px on new controls; spacing on the 4/8 scale; mobile-first.
- No em dashes in user-facing copy.
- Per-task gates: `npx tsc --noEmit` (no new errors) + `npm run lint` clean for touched files; `npm run test` green for any task with a `*.test.ts`.

## File Structure

**New**
- `src/lib/pagination.ts` + `src/lib/pagination.test.ts` — `PAYMENTS_PAGE_SIZE`, `pageRange`, `nextPageParam`.
- `src/lib/initials.ts` + `src/lib/initials.test.ts` — `personInitials`.
- `src/components/redesign/shared/ListFilterBar.tsx` — shared mobile filter-row layout.
- `src/components/redesign/shared/AvatarEditor.tsx` — avatar editor promoted from cleaner profile.
- `src/components/redesign/payments/paymentsKpis.ts` + `paymentsKpis.test.ts` — KPI item builder.
- `src/components/redesign/payments/PaymentsKpiStrip.tsx` — 5 `StatTile` cards.
- `src/hooks/useAdminPaymentsInfinite.ts` (or added to `useAdminData.ts`) — `useAdminPaymentsInfinite`, `useAdminPayoutsInfinite`.

**Modified**
- `src/components/redesign/customers/OperatorCustomersView.tsx` — use `ListFilterBar`.
- `src/components/redesign/cleaners/OperatorCleanersView.tsx` — use `ListFilterBar`, fix full-width sort, normalize breakpoint.
- `src/components/redesign/services/OperatorServicesView.tsx`, `ServicesList.tsx` — `ListFilterBar` + white-card list + blue select.
- `src/components/redesign/shell/OperatorMobileNav.tsx` — extended "New booking" FAB.
- `src/components/redesign/messages/MessageThreadPanel.tsx`, `MessageComposer.tsx` — white header/composer, tinted list, Details variant.
- `src/components/ui/button.tsx` — only if a white-surface variant tweak is needed for Details.
- `src/components/redesign/payments/OperatorPayments.tsx`, `OperatorPaymentsView.tsx`, `PaymentsTable.tsx`/`PaymentsCardList.tsx` (Load more) — KPI strip, pagination, remove subtitle.
- `src/components/redesign/settings/sections/ProfileSection.tsx` — use `AvatarEditor`.
- `src/components/redesign/cleaner/profile/CleanerAvatarEditor.tsx`, `deriveProfile.ts` (+ test) — re-point to shared primitives.
- `src/lib/queryKeys.ts` — infinite payment/payout keys.

---

## Group A, Shared foundations

### Task A1: `ListFilterBar` layout primitive

**Files:**
- Create: `src/components/redesign/shared/ListFilterBar.tsx`
- Verify: Playwright (used via B1/B2/E).

**Interfaces:**
- Produces: `ListFilterBar({ search, children, className })` — `search` is a ReactNode (the full-width search input slot); `children` are the compact controls.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Mobile list filter layout: full-width search on its own row, then a wrapping
 * row of compact auto-width controls (sort / status / toggles). At sm+ it
 * collapses to a single inline row. Layout only, no business logic.
 */
export function ListFilterBar({
  search,
  children,
  className,
}: {
  search: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3", className)}>
      <div className="w-full sm:max-w-xl sm:flex-1">{search}</div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">{children}</div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep ListFilterBar` — Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/shared/ListFilterBar.tsx
git commit -m "feat(redesign): ListFilterBar layout primitive"
```

### Task A2: `personInitials` shared helper (TDD)

**Files:**
- Create: `src/lib/initials.ts`, `src/lib/initials.test.ts`
- Modify (Step 5): `src/components/redesign/cleaner/profile/deriveProfile.ts` + `deriveProfile.test.ts`

**Interfaces:**
- Produces: `personInitials(first?: string | null, last?: string | null): string` — up to 2 uppercase letters, `""` when neither name is present.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { personInitials } from "./initials";

describe("personInitials", () => {
  it("takes first letter of each name, uppercased", () => {
    expect(personInitials("David", "Reynolds")).toBe("DR");
  });
  it("handles a single name", () => {
    expect(personInitials("Madonna", "")).toBe("M");
    expect(personInitials(null, "Cher")).toBe("C");
  });
  it("returns empty string when no name", () => {
    expect(personInitials("", null)).toBe("");
  });
  it("trims whitespace", () => {
    expect(personInitials("  ada ", " lovelace ")).toBe("AL");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test:unit -- src/lib/initials.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** Up to two uppercase initials from a person's first/last name. */
export function personInitials(first?: string | null, last?: string | null): string {
  const a = (first ?? "").trim();
  const b = (last ?? "").trim();
  return `${a.charAt(0)}${b.charAt(0)}`.toUpperCase();
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm run test:unit -- src/lib/initials.test.ts` — Expected: PASS.

- [ ] **Step 5: Re-point the cleaner helper**

`cleanerInitials` (`deriveProfile.ts:14`) takes a SINGLE object `(p: ProfileNameLike)` with `.firstName`/`.lastName` and returns `"U"` for the empty case (`deriveProfile.test.ts` asserts `"U"`; `CleanerProfileView.tsx:61` passes an object). Reimplement preserving that exact contract:

```ts
export const cleanerInitials = (p: ProfileNameLike): string =>
  personInitials(p.firstName, p.lastName) || "U";
```

The `|| "U"` MUST stay (`personInitials("","")` returns `""`). Do not touch the call site. Run `npm run test:unit -- src/components/redesign/cleaner/profile/deriveProfile.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/initials.ts src/lib/initials.test.ts src/components/redesign/cleaner/profile/deriveProfile.ts
git commit -m "feat(redesign): shared personInitials helper"
```

### Task A3: `AvatarEditor` shared primitive

**Files:**
- Create: `src/components/redesign/shared/AvatarEditor.tsx`
- Modify: `src/components/redesign/cleaner/profile/CleanerAvatarEditor.tsx` (re-export / thin wrapper)

**Interfaces:**
- Produces: `AvatarEditor({ currentAvatarUrl?, initials, onUploaded })` — the EXACT contract `CleanerAvatarEditor` exposes today (`CleanerAvatarEditor.tsx:20-28`): `currentAvatarUrl?: string`, `initials: string`, `onUploaded: (url: string) => void`, on `useImageUpload`, brand tokens. `AvatarFallback` renders `{initials}` with no internal fallback, so callers must pass a non-empty string. Lift the body verbatim into the shared file (it is already on-system); it computes no initials inline.

- [ ] **Step 1:** Read `CleanerAvatarEditor.tsx`. Move its implementation into `src/components/redesign/shared/AvatarEditor.tsx`, renaming the export to `AvatarEditor`, using `personInitials` for the fallback if it computed initials inline.
- [ ] **Step 2:** Replace `CleanerAvatarEditor.tsx` body with `export { AvatarEditor as CleanerAvatarEditor } from "@/components/redesign/shared/AvatarEditor";` (keeps the cleaner profile import working).
- [ ] **Step 3:** Type-check + grep for legacy color leak.

Run: `npx tsc --noEmit 2>&1 | grep -i avatar` (expect none) and `grep -nE "#F7C41E|primary-[0-9]|rgba\(217" src/components/redesign/shared/AvatarEditor.tsx` (expect none).

- [ ] **Step 4:** Run cleaner profile tests: `npm run test:unit -- src/components/redesign/cleaner/profile` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/shared/AvatarEditor.tsx src/components/redesign/cleaner/profile/CleanerAvatarEditor.tsx
git commit -m "refactor(redesign): promote AvatarEditor to a shared primitive"
```

---

## Group B, List toolbars (Customers, Cleaners)

### Task B1: Customers toolbar -> `ListFilterBar`

**Files:**
- Modify: `src/components/redesign/customers/OperatorCustomersView.tsx`

- [ ] **Step 1:** Read the file. The search is NOT a bare `<Input>`, it is a `relative` wrapper with an absolutely-positioned `Search` icon (`OperatorCustomersView.tsx:112-122`). Pass that whole wrapper as `ListFilterBar`'s `search` node and **drop its own `sm:flex-1 sm:max-w-xl`** classes (the `ListFilterBar` slot already applies `w-full sm:max-w-xl sm:flex-1`, leaving them double-constrains). Put the sort `Select` as a child and remove the sort trigger's `w-full` (use `w-auto`/default min-width). Keep the create button where it is.
- [ ] **Step 2:** Type-check the file. Run: `npx tsc --noEmit 2>&1 | grep OperatorCustomersView` — Expected: none.
- [ ] **Step 3: Visual verify (Playwright MCP).** With `npm run dev` running and the redesign flag on, navigate to the Customers screen at 375px. Confirm: create button row, search row, then a single compact sort control (not full-width). Screenshot. Repeat at 1280px (sort sits inline right of search).
- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/customers/OperatorCustomersView.tsx
git commit -m "feat(redesign): compact Customers mobile toolbar"
```

### Task B2: Cleaners & team toolbar -> `ListFilterBar`

**Files:**
- Modify: `src/components/redesign/cleaners/OperatorCleanersView.tsx`

- [ ] **Step 1:** Read the file. Today `PeopleSegmentTabs` + search + sort + benched live in ONE container that only goes row at `lg` (`OperatorCleanersView.tsx:188`). Restructure:
  - **Pull the `PeopleSegmentTabs` out of the filter row** onto its own row (it is a view switch, keep `PeopleSegmentTabs` as-is, do not route it through `ListFilterBar`).
  - Wrap search + sort + benched in `ListFilterBar`: the search wrapper as the `search` node (drop its `lg:flex-1 lg:max-w-xl`, line ~190), the sort `Select` (drop `lg:w-48 lg:shrink-0` → `w-auto`, line ~202) and the benched toggle (drop `lg:shrink-0`, line ~217) as children.
  - The benched toggle is **conditionally rendered** (`benchedCount > 0 || showBenched`, line ~213), so it is a possibly-absent `ListFilterBar` child, fine, `ListFilterBar` handles `undefined`/falsy children. Its label `Show benched (N)` is wide; verify it wraps cleanly at 375px.
  - Leave the "Showing X of Y" line (~227-231) where it is (outside the toolbar).
  - Normalize the responsive collapse to `sm` (via `ListFilterBar`), not `lg`.
- [ ] **Step 2:** Type-check. Run: `npx tsc --noEmit 2>&1 | grep OperatorCleanersView` — Expected: none.
- [ ] **Step 3: Visual verify.** Cleaners screen at 375px: create, segment switch, search, then one wrapping row [sort] [benched] (sort no longer edge-to-edge). Screenshot. 1280px inline.
- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/cleaners/OperatorCleanersView.tsx
git commit -m "feat(redesign): compact Cleaners & team mobile toolbar"
```

---

## Group C, FAB

### Task C1: Extended "New booking" FAB

**Files:**
- Modify: `src/components/redesign/shell/OperatorMobileNav.tsx`

- [ ] **Step 1:** Replace the icon-only FAB (lines ~34-41) with an extended FAB: swap `Plus` for `CalendarPlus` (lucide), add the visible label, keep `onClick={onNewBooking}` and `aria-label="New booking"`.

```tsx
import { Menu, CalendarPlus } from "lucide-react";
// ...
<Button
  onClick={onNewBooking}
  aria-label="New booking"
  className="fixed bottom-[76px] right-4 z-40 h-12 gap-2 rounded-pill px-4 shadow-soft-lg lg:hidden"
>
  <CalendarPlus className="h-5 w-5" aria-hidden />
  <span className="text-sm font-semibold">New booking</span>
</Button>
```

- [ ] **Step 2:** Confirm Settings should not show it. The FAB renders inside `OperatorMobileNav`, which is part of the shell shown on all redesign operator routes. If Settings should be excluded, gate the FAB on the active route (e.g. hide when `activeId === "settings"`). Read how `activeId` is passed; add `activeId !== "settings"` to the FAB's render condition.
- [ ] **Step 3:** Type-check. Run: `npx tsc --noEmit 2>&1 | grep OperatorMobileNav` — Expected: none.
- [ ] **Step 4: Visual verify.** Any operator screen at 375px: a labeled "New booking" pill bottom-right above the tab bar, not overlapping the bottom nav; not on Settings. Tapping it opens the existing New-booking flow (unchanged). Screenshot.
- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/shell/OperatorMobileNav.tsx
git commit -m "feat(redesign): label the New-booking FAB"
```

---

## Group D, Messages thread surfaces

### Task D1: White header + composer, tinted list, Details variant

**Files:**
- Modify: `src/components/redesign/messages/MessageThreadPanel.tsx`, `src/components/redesign/messages/MessageComposer.tsx`
- Possibly: `src/components/ui/button.tsx` (only if no existing variant reads on white)

- [ ] **Step 1:** Read both files. In `MessageThreadPanel`: remove the off-system gradient (`bg-gradient-to-b from-background to-muted/30`, line ~110) from the panel container; set the container to `bg-background` (warm canvas). Set the **header strip** (currently `bg-background`, line ~112) to `bg-card` (white) keeping its bottom border. Set the **message scroll area** (no explicit bg today, line ~161) explicitly to `bg-background` (warm tint) so white incoming bubbles (`bg-card`) still separate.
  - **Do NOT touch the bubble colors.** In this codebase the bare token `bg-primary` (DEFAULT) = `hsl(var(--primary))` = brand blue `#0150FC` (only the numbered `primary-50..900` ramp is legacy yellow). Sent bubbles (`MessageBubble.tsx:44` `bg-primary`), the send button, and the attach button are already brand blue, leave them. The D1 conformance grep does not flag `bg-primary` for this reason.
- [ ] **Step 2:** In `MessageComposer`: set the outer wrapper to `bg-card` (white) with its top border. Change the input container from `bg-muted/50` to a clean field on white: `border border-border bg-card` (add `shadow-soft-sm` only if it needs separation). Keep the send button brand-when-active / muted-when-empty; keep the attach button brand-tint.
- [ ] **Step 3:** Details button (in `MessageThreadPanel:134-135`) ALREADY uses `variant={props.detailsOpen ? 'secondary' : 'outline'}`, so this is **verify-only, not a change**. But `secondary` = `bg-secondary` (warm-100 `#EFEDE8`) with dark text, which is **low-contrast on the now-white header**. Verify on white; the active state will likely need strengthening, prefer a brand-tinted active treatment (e.g. an active style that reads on white) via a `button.tsx` variant/state tweak rather than an inline class. Do not regress the inactive `outline` look.
- [ ] **Step 4:** Type-check. Run: `npx tsc --noEmit 2>&1 | grep -E "MessageThreadPanel|MessageComposer"` — Expected: none. Conformance grep: `grep -nE "#F7C41E|rgba\(217|from-background to-muted" src/components/redesign/messages/MessageThreadPanel.tsx src/components/redesign/messages/MessageComposer.tsx` — Expected: none.
- [ ] **Step 5: Visual verify.** Open a conversation at 375px and desktop: white header with a clean Details button, warm-tinted message list with legible white incoming + blue sent bubbles, white composer with a bordered input. Screenshot both. Toggle Details to confirm active/inactive states.
- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/messages/MessageThreadPanel.tsx src/components/redesign/messages/MessageComposer.tsx src/components/ui/button.tsx
git commit -m "feat(redesign): white message thread header + composer, tinted list"
```

---

## Group E, Services (cards + hybrid structure)

### Task E1: White-card service list + blue select + `ListFilterBar`

**Files:**
- Modify: `src/components/redesign/services/ServicesList.tsx`, `src/components/redesign/services/OperatorServicesView.tsx`
- Reference (read, do not import): `src/components/redesign/cleaner/profile/CleanerServicesCatalogView.tsx`

- [ ] **Step 1:** Read all three. The REAL defect (correcting the spec): `ServicesList` rows are *invisible*, `rounded-field border-transparent`, no `bg-card`, no chevron (`ServicesList.tsx`, the only consumer is `OperatorServicesView.tsx:155`). Restyle each row to an on-system card matching the cleaner catalog's visual language (`rounded-card border border-border bg-card p-3.5 shadow-soft-sm`, model on `CleanerServicesCatalogView.tsx:38-54`), an icon pill, name + meta (type, duration, price), and a trailing `ChevronRight`. Build it as an operator card (do not import the cleaner component).
- [ ] **Step 2:** Selected state (desktop two-pane): the existing `bg-primary/10` is **brand blue at 10% (NOT legacy yellow)**, the spec's "yellow" claim was wrong. It is acceptable as-is, but since the rows are now white cards, strengthen the selected affordance to read against white: `border-brand-600 bg-brand-50` (tokens). Never use the numbered `primary-50..900` ramp (that IS yellow).
- [ ] **Step 3:** In `OperatorServicesView`, wrap the Services search + sort + status filter in `ListFilterBar` (same pattern as B1/B2); keep the "hide toolbar when a service is selected" behavior on mobile.
- [ ] **Step 4:** Conformance grep: `grep -nE "#F7C41E|primary-[0-9]|rgba\(217|rounded-field|border-transparent" src/components/redesign/services/ServicesList.tsx` — Expected: none (cards now `rounded-card`+`bg-card`; `bg-primary/bg-brand` are allowed brand tokens, do NOT grep for them). Type-check the three files.
- [ ] **Step 5: Visual verify.** Services at 375px (white cards + chevron, compact toolbar) and desktop (white cards left, brand-blue selected row). Screenshot.
- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/services/ServicesList.tsx src/components/redesign/services/OperatorServicesView.tsx
git commit -m "feat(redesign): white-card Services list + brand select"
```

### Task E2: Mobile service detail reads as a full-screen editable page

**Files:**
- Modify: `src/components/redesign/services/OperatorServicesView.tsx` (and `ServiceDetailPane.tsx` only if a back affordance is missing)

- [ ] **Step 1:** This is **largely verify-only**, the hybrid already works: on mobile, selecting a service drops to a full-width detail with the list hidden (`OperatorServicesView.tsx:144` `selectedId && "hidden lg:block"`), the toolbar hides (line ~109), `ServiceDetailPane.tsx:53` already renders an `lg:hidden` ghost back button labeled **"All services"** (calls `onBack`=`clearSelection`), and a stale `?service` is dropped on mobile select (`OperatorServices.tsx:235-246`). **Keep the existing "All services" label** (do not rename to "< Services"). Reuse `ServiceDetailPane` content unchanged.
- [ ] **Step 2:** Keep desktop as the two-pane (no nav change on desktop). Only ensure the mobile detail reads as a clean full-screen "page" after the E1 card restyle, adjust spacing/heading only if it looks unfinished.
- [ ] **Step 3:** Type-check. Visual verify at 375px: tap a card -> full-screen editable service page with the "All services" back control; back returns to the list; edit/duplicate/checklists still work. Screenshot.
- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/services/OperatorServicesView.tsx src/components/redesign/services/ServiceDetailPane.tsx
git commit -m "feat(redesign): full-screen mobile service detail page"
```

---

## Group F, Payments (KPI cards + pagination)

### Task F1: Pagination math helpers (TDD)

**Files:**
- Create: `src/lib/pagination.ts`, `src/lib/pagination.test.ts`

**Interfaces:**
- Produces: `PAYMENTS_PAGE_SIZE = 25`; `pageRange(pageIndex, pageSize): { from, to }`; `nextPageParam(lastPageLength, pagesLoaded, pageSize): number | undefined`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { pageRange, nextPageParam, PAYMENTS_PAGE_SIZE } from "./pagination";

describe("pageRange", () => {
  it("computes zero-based supabase range bounds", () => {
    expect(pageRange(0, 25)).toEqual({ from: 0, to: 24 });
    expect(pageRange(2, 25)).toEqual({ from: 50, to: 74 });
  });
});

describe("nextPageParam (count-aware, avoids a dead empty fetch)", () => {
  it("returns the next page index while loaded < total", () => {
    expect(nextPageParam(25, 57, 1)).toBe(1);
    expect(nextPageParam(50, 57, 2)).toBe(2);
  });
  it("returns undefined once all rows are loaded", () => {
    expect(nextPageParam(57, 57, 3)).toBeUndefined();
    expect(nextPageParam(0, 0, 0)).toBeUndefined();
    expect(nextPageParam(25, 25, 1)).toBeUndefined(); // exact multiple: no extra empty fetch
  });
});

describe("PAYMENTS_PAGE_SIZE", () => {
  it("is 25", () => expect(PAYMENTS_PAGE_SIZE).toBe(25));
});
```

- [ ] **Step 2:** Run, verify fail: `npm run test:unit -- src/lib/pagination.test.ts` — FAIL.
- [ ] **Step 3: Implement**

```ts
export const PAYMENTS_PAGE_SIZE = 25;

/** Supabase .range() bounds for a zero-based page index. */
export function pageRange(pageIndex: number, pageSize: number): { from: number; to: number } {
  const from = pageIndex * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** Next page index for useInfiniteQuery; undefined once all rows are loaded.
 *  Count-aware (uses the exact total from `{ count: 'exact' }`) so an exact
 *  page-size multiple does not trigger a wasted empty fetch. */
export function nextPageParam(
  loadedCount: number,
  total: number,
  pagesLoaded: number,
): number | undefined {
  return loadedCount < total ? pagesLoaded : undefined;
}
```

- [ ] **Step 4:** Run, verify pass. **Step 5:** Commit.

```bash
git add src/lib/pagination.ts src/lib/pagination.test.ts
git commit -m "feat(redesign): pagination range/next-page helpers"
```

### Task F2: Infinite payments + payouts hooks

**Files:**
- Modify: `src/hooks/useAdminData.ts` (add new hooks; do NOT change `useAdminPayments`/`useAdminPayouts`), `src/lib/queryKeys.ts`

**Interfaces:**
- Produces: `useAdminPaymentsInfinite()` and `useAdminPayoutsInfinite()` returning `{ rows, total, hasMore, fetchNextPage, isFetchingNextPage, loading, refetch }`. `rows` is the flattened accumulation of loaded pages (`AdminPayment[]` / `AdminPayout[]`); `total` is the exact count.

- [ ] **Step 1:** Read `useAdminData.ts:540-720` to copy the exact `select` strings, joins, and realtime wiring used by `useAdminPayments`/`useAdminPayouts`.
- [ ] **Step 2:** Add `keys.payments.infinite(orgId)` / `keys.payouts.infinite(orgId)` to `queryKeys.ts`.
- [ ] **Step 3:** Implement with `useInfiniteQuery` **directly** (NOT `useOrgQuery`, which only wraps `useQuery`). Replicate the auth gate by hand: read `currentOrganizationId` from `useAuth()`, set `enabled: !!currentOrganizationId`, and use `orgId` inside the `queryFn`. Mirror the existing select + `.eq('organization_id', orgId)` + `.order('created_at', { ascending: false })`, adding `{ count: 'exact' }` and `.range(from, to)` from `pageRange(pageParam, PAYMENTS_PAGE_SIZE)`. `initialPageParam: 0`. Count-aware next page (avoids the empty fetch at exact multiples):

```ts
getNextPageParam: (lastPage, all) => {
  const loaded = all.reduce((n, p) => n + p.rows.length, 0);
  return nextPageParam(loaded, lastPage.count, all.length); // lastPage.count = exact total
}
```

  Derive the return with **null-guards** (while `enabled` is false / first load, `data` is `undefined`, so `data.pages` would throw):

```ts
const rows = data?.pages.flatMap((p) => p.rows) ?? [];
const total = data?.pages?.[0]?.count ?? 0;
return { rows, total, hasMore: hasNextPage, fetchNextPage, isFetchingNextPage, loading: isLoading, refetch };
```

- [ ] **Step 3b (realtime):** Wire `useSupabaseRealtimeSync` so the list stays fresh, invalidating the **INFINITE** key, not the legacy `byOrg` key. `useAdminPaymentsInfinite` mirrors `useAdminPayments`'s subs (`refunds`, `disputes`) but with `{ type: 'invalidate', keys: [keys.payments.infinite(orgId), keys.payments.statsByOrg(orgId)] }`; `useAdminPayoutsInfinite` invalidates `keys.payouts.infinite(orgId)`. (Invalidating an infinite key in v5 refetches ALL loaded pages, it does not reset to page 1, so loaded pages are preserved.) Note: the redesign payments screen has no direct `payments`-table INSERT sub today (record/refund call `refetch` directly); do not assume copying the legacy sub adds one.

```ts
// shape of each page's queryFn return
type PaymentsPage = { rows: AdminPayment[]; count: number };
// queryFn:
const { from, to } = pageRange(pageParam as number, PAYMENTS_PAGE_SIZE);
const { data, count, error } = await supabase
  .from("payments")
  .select(PAYMENTS_SELECT, { count: "exact" })   // PAYMENTS_SELECT = existing select string
  .eq("organization_id", orgId)
  .order("created_at", { ascending: false })
  .range(from, to);
if (error) throw error;
return { rows: (data ?? []) as AdminPayment[], count: count ?? 0 };
```

- [ ] **Step 4:** Type-check `useAdminData.ts` + `queryKeys.ts`. Run `npm run test:unit` (ensure nothing broke). Lint.
- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAdminData.ts src/lib/queryKeys.ts
git commit -m "feat(redesign): infinite admin payments + payouts hooks"
```

### Task F3: KPI item builder (TDD) + `PaymentsKpiStrip`

**Files:**
- Create: `src/components/redesign/payments/paymentsKpis.ts`, `paymentsKpis.test.ts`, `PaymentsKpiStrip.tsx`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { paymentsKpiItems } from "./paymentsKpis";

describe("paymentsKpiItems", () => {
  it("returns the five tiles with formatted values", () => {
    const items = paymentsKpiItems({
      totalRevenue: 6669, thisMonth: 816, queuedPayouts: 0, txnCount: 57, payoutCount: 22,
    });
    expect(items.map((i) => i.label)).toEqual([
      "Revenue", "This month", "Queued payouts", "Transactions", "Payouts",
    ]);
    expect(items[0].value).toContain("6,669");
    expect(items[3].value).toBe("57");
    expect(items[4].value).toBe("22");
  });
});
```

- [ ] **Step 2:** Run, fail. **Step 3:** Implement:

```ts
import { money2 } from "./payments-presenters";

export function paymentsKpiItems(a: {
  totalRevenue: number; thisMonth: number; queuedPayouts: number; txnCount: number; payoutCount: number;
}): { label: string; value: string }[] {
  return [
    { label: "Revenue", value: money2(a.totalRevenue) },
    { label: "This month", value: money2(a.thisMonth) },
    { label: "Queued payouts", value: money2(a.queuedPayouts) },
    { label: "Transactions", value: String(a.txnCount) },
    { label: "Payouts", value: String(a.payoutCount) },
  ];
}
```

- [ ] **Step 4:** Run, pass. **Step 5:** Write `PaymentsKpiStrip.tsx` rendering the items as `StatTile` in a responsive grid with icons:

```tsx
"use client";
import { DollarSign, CalendarRange, Hourglass, Receipt, Banknote } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { paymentsKpiItems } from "./paymentsKpis";

const ICONS = [<DollarSign />, <CalendarRange />, <Hourglass />, <Receipt />, <Banknote />];

export function PaymentsKpiStrip(props: {
  totalRevenue: number; thisMonth: number; queuedPayouts: number;
  txnCount: number; payoutCount: number; loading?: boolean;
}) {
  if (props.loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-card" />)}
      </div>
    );
  }
  const items = paymentsKpiItems(props);
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((it, i) => <StatTile key={it.label} label={it.label} value={it.value} icon={ICONS[i]} />)}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/payments/paymentsKpis.ts src/components/redesign/payments/paymentsKpis.test.ts src/components/redesign/payments/PaymentsKpiStrip.tsx
git commit -m "feat(redesign): Payments KPI tile strip"
```

### Task F4: Wire pagination + KPI strip into the Payments screen

**Files:**
- Modify: `src/components/redesign/payments/OperatorPayments.tsx`, `OperatorPaymentsView.tsx`, `PaymentsTable.tsx` + `PaymentsCardList.tsx` (Load more button placement)

- [ ] **Step 1:** In `OperatorPayments.tsx`: swap `useAdminPayments()` -> `useAdminPaymentsInfinite()` and `useAdminPayouts()` -> `useAdminPayoutsInfinite()`. Map `payments = txn.rows`, `payouts = payout.rows`. Replace `txnTotal={payments.length}` / `payoutTotal={payouts.length}` with `txnTotal={txn.total}` / `payoutTotal={payout.total}`. Pass new props for the active ledger: `hasMore`, `onLoadMore` (= the active ledger's `fetchNextPage`), `loadingMore` (= `isFetchingNextPage`), picked by `ledger`. Keep `refetch` wiring (refund/retry/dismiss/record) pointing at the infinite hooks' `refetch`. **Remove the now-unused `PaymentsMoneyGlance` import** (line 24) once Step 2 replaces it (CI `npm run lint` flags unused imports).
- [ ] **Step 2:** Replace the `moneyGlance` node: drop `PaymentsMoneyGlance`, pass `<PaymentsKpiStrip totalRevenue=... thisMonth=... queuedPayouts=... txnCount={txn.total} payoutCount={payout.total} loading={statsLoading} />`.
- [ ] **Step 3:** In `OperatorPaymentsView.tsx`: remove the count subtitle `<p>...{countLabel}</p>` under the `Payments` h1 AND the now-unused `countLabel` computation (lines ~97-101), keep the h1 and Record-payment button. Add `hasMore`, `onLoadMore`, `loadingMore` to `OperatorPaymentsViewProps`. Import `Loader2` (not currently imported).

  **Fix the empty-state dead-end (review HIGH):** with client filtering on loaded-only rows, a search whose match is on an unloaded page yields `rowsLen === 0`, and the current empty branch `return`s before any "Load more", a dead end. Restructure so "Load more" stays reachable:

```tsx
// when the filtered view is empty but more rows exist server-side, the empty
// state's action loads more (so the user can reach an unloaded match):
action={
  filtersActive && hasMore ? (
    <Button variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
      {loadingMore ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
      Load more {noun}s to search
    </Button>
  ) : filtersActive ? (
    <Button variant="secondary" onClick={() => { onSearchChange(""); onStatusFilterChange("all"); }}>
      Clear filters
    </Button>
  ) : undefined
}
```

  And below the populated list, the normal Load more:

```tsx
{hasMore ? (
  <div className="flex justify-center pt-2">
    <Button variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
      {loadingMore ? <Loader2 className="mr-2 size-4 animate-spin" /> : null} Load more
    </Button>
  </div>
) : null}
```

  Also reword the filtered-empty title from "No {noun}s match your filters" to "No matches in the loaded {noun}s" when `hasMore` (so it does not imply the whole ledger was searched).

- [ ] **Step 4:** Type-check all four files; run `npm run test` (KPI + pagination tests green, nothing else broke); lint.
- [ ] **Step 5: Integration check.** If `OperatorPayments` has an integration/unit test, update it. Manually verify (Playwright) that revenue/queued tiles match prior values and counts equal totals.
- [ ] **Step 6: Visual verify.** Payments at 375px (2-col KPI grid, no subtitle, list shows 25 then "Load more") and desktop (5 tiles in a row). Click "Load more", confirm it appends and the network call fetches the next range. Screenshot.
- [ ] **Step 7: Commit**

```bash
git add src/components/redesign/payments/OperatorPayments.tsx src/components/redesign/payments/OperatorPaymentsView.tsx src/components/redesign/payments/PaymentsTable.tsx src/components/redesign/payments/PaymentsCardList.tsx
git commit -m "feat(redesign): Payments KPI cards + load-more pagination"
```

---

## Group G, Settings avatar

### Task G1: Modernize the Profile avatar control

**Files:**
- Modify: `src/components/redesign/settings/sections/ProfileSection.tsx`

- [ ] **Step 1:** Read `ProfileSection.tsx`. Replace `AvatarUpload` with `AvatarEditor` (Task A3). Prop delta: `AvatarUpload` was `{ currentAvatarUrl, onUploadSuccess, size }`; `AvatarEditor` is `{ currentAvatarUrl, initials, onUploaded }`. So: keep `currentAvatarUrl={user?.profile.avatarUrl}`, rename `onUploadSuccess` -> `onUploaded={(url) => updateProfile({ avatarUrl: url })}` (`updateProfile` already comes from `useAuth()`, used in `ProfileSection`), **drop** `size` (no such prop), and **add** a non-empty `initials`:

```ts
const initials =
  personInitials(value.firstName, value.lastName) ||
  user?.email?.charAt(0)?.toUpperCase() ||
  "U";
```

  (`AvatarFallback` renders `{initials}` directly, so an empty string would show a blank circle, the `|| ... || "U"` guards it.) Do not touch `OperatorSettingsView` layout (desktop one white card; mobile `?section=` tabs both unchanged).
- [ ] **Step 2:** Conformance grep: `grep -nE "AvatarUpload|#F7C41E|primary-[0-9]|rgba\(217" src/components/redesign/settings/sections/ProfileSection.tsx` — Expected: none. Type-check the file.
- [ ] **Step 3: Visual verify.** Settings -> Profile at 375px and desktop: the avatar control is brand blue (no yellow "Change photo"), desktop stays one white card, mobile stays tabbed. Upload a photo to confirm the callback persists. Screenshot.
- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/settings/sections/ProfileSection.tsx
git commit -m "feat(redesign): modernize Settings profile avatar"
```

---

## Final verification (before PR)

- [ ] **Full gates:** `npm run test` (all green), `npx tsc --noEmit` (no new errors in touched files), `npm run lint` (clean for touched files).
- [ ] **Conformance sweep:** `grep -rnE "#F7C41E|rgba\(217,167,24|bg-primary-|text-primary-|from-background to-muted" src/components/redesign/{customers,cleaners,services,messages,payments,settings,shell,shared}` — Expected: no matches in files this PR touched.
- [ ] **Playwright smoke:** the existing redesign e2e specs still pass (or skip) against the preview; no new spec required (these are visual polish changes covered by manual MCP verification, consistent with prior slices).
- [ ] **One Codex review** on the branch (`/codex:review --scope branch --base master --wait` or the codex-rescue agent), apply valid fixes, then push + open PR to master.

## Self-review (plan)

- **Spec coverage:** Surface 1 -> B1/B2/E1; Surface 2 (FAB) -> C1; Surface 3 -> D1; Surface 4 -> E1/E2; Surface 5 -> F1-F4; Surface 6 -> A3/G1. All six covered.
- **Placeholders:** none; logic tasks carry full test + impl code, presentational tasks carry exact files + token-level change specs + a concrete verify step.
- **Type consistency:** `useAdminPaymentsInfinite` returns `{ rows, total, hasMore, fetchNextPage, isFetchingNextPage, loading, refetch }`, consumed exactly so in F4; `paymentsKpiItems` shape matches `PaymentsKpiStrip`; `personInitials` signature consistent across A2/A3/G1; `ListFilterBar({search, children})` consistent across B1/B2/E1.
- **Risk notes:** (1) `useAdminPayments`/`useAdminPayouts` are NOT modified (legacy admin + manager dashboards depend on them), new infinite hooks are additive. (2) Counts come from `{ count: 'exact' }`, no migration. This is a deliberate **divergence from spec Surface 5(a)** (which said extend `payment_stats`), the exact count is org-total and pagination-independent, so it serves the KPI better without an RPC change. (3) Client filter/sort apply to loaded rows only, the empty-state now keeps "Load more" reachable so it is not a dead end (review HIGH fixed in F4). (4) **Token fact (verified):** bare `bg-primary`/`text-primary` = brand blue `#0150FC` in this codebase; only the numbered `primary-50..900` ramp is legacy yellow. Message bubbles and the Services selected state are already brand, do not "fix" them; the conformance greps target `primary-[0-9]` / `#F7C41E` / `rgba(217,167,24` only. (5) Details button variants already exist (verify-only), but `secondary` on the new white header is low-contrast, expect a small active-state tweak in `button.tsx`.
