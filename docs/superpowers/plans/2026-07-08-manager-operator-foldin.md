# Manager Operator Fold-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This plan is UI in the `(redesign)` route group; follow the `ui-feature-workflow` + `ui-ux-pro-max` design-system rules (implement from `src/components/ui/*` + tokens, never raw hex).
>
> **Depends on** `2026-07-08-manager-permissions-enforcement.md` (the `managerFlags` registry + 14-flag `ManagerPermissions` must exist first).

**Goal:** Route managers into the already-built redesigned Operator console and gate it by their permissions: permission-filtered nav, silent redirect guards on forbidden routes, and a stripped-down manager Overview with a drop-and-reflow KPI strip.

**Architecture:** Managers reuse the admin `/app/admin-dashboard` tree (admin + manager = one permissioned "Operator" experience). A `useOperatorNav()` hook filters `OPERATOR_NAV` by role/permissions and is threaded into the shell; a `useRequireManagerFlag(flag)` hook redirects a manager who lacks a tab's flag back to Overview; `OperatorOverview` renders a manager hero variant and a permission-gated KPI strip. No new screens.

**Tech Stack:** Next.js 16 App Router (`(redesign)` group), React 19, TanStack Query, `useAuth` (`currentOrgRole`), `useManagerPermissions`, Vitest unit tests, Playwright/MCP screenshots.

## Global Constraints

- `privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin'` bypasses every per-flag gate. Only `manager` is gated. Replicate the existing `privileged || permissions?.flag` idiom from `OperatorOverview.tsx`.
- `useManagerPermissions()` returns all-false for admins/owners (no `manager_permissions` row); never gate admins on it. It is realtime, so gates flip live.
- UI implemented from the design system (`src/components/ui/*` + tokens in `tailwind.config.js` / `src/app/globals.css`). Companion mockups are structure reference only, no raw hex / off-system styling.
- No em dashes in user-facing copy.
- `settings` and `overview` nav items are ALWAYS visible (never filtered). Keep `settings`'s `mt-auto` bottom anchor intact.
- Redesign is flag-gated: `NEXT_PUBLIC_REDESIGN_ENABLED === 'true'` (dev/preview always on). Legacy `/manager-dashboard` stays working with the flag off (deleting it belongs to the global cutover, out of scope).

**Nav item → governing flag map** (used by both the nav filter and the route guards):
`bookings → can_view_bookings`, `people (customers) → can_view_customers`, `cleaners → can_manage_cleaners`, `services → can_view_services`, `payments → can_view_payments`, `analytics → can_view_analytics`, `messages → can_view_messages`. `overview` and `settings` → no flag (always visible).

---

## Task 1: Route managers to the redesigned Operator console

**Files:**
- Modify: `src/lib/redesign/dashboardPath.ts`
- Modify: `src/lib/redesign/dashboardPath.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getDashboardPath('manager', { redesign: true }) === '/app/admin-dashboard'`.

- [ ] **Step 1: Update the failing test first**

In `dashboardPath.test.ts`, change the manager assertions to:

```ts
expect(getDashboardPath('manager')).toBe('/manager-dashboard');
expect(getDashboardPath('manager', { redesign: true })).toBe('/app/admin-dashboard');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:unit -- src/lib/redesign/dashboardPath.test.ts`
Expected: FAIL (redesign case returns `/manager-dashboard`).

- [ ] **Step 3: Implement**

In `dashboardPath.ts`, change the manager branch:

```ts
case "manager":
  return redesign ? "/app/admin-dashboard" : "/manager-dashboard";
```

- [ ] **Step 4: Pass**

Run: `npm run test:unit -- src/lib/redesign/dashboardPath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/redesign/dashboardPath.ts src/lib/redesign/dashboardPath.test.ts
git commit -m "feat(redesign): route managers to the Operator console when redesign is on"
```

---

## Task 2: Permission-filtered Operator navigation

**Files:**
- Modify: `src/components/redesign/shell/nav-items.ts` (add `requires?` metadata + a filter helper)
- Create: `src/components/redesign/shell/useOperatorNav.ts` (hook)
- Create: `src/components/redesign/shell/nav-items.test.ts` (unit test for the pure filter)
- Modify: `src/components/redesign/shell/OperatorShell.tsx` (compute filtered nav, pass down)
- Modify: `src/components/redesign/shell/OperatorRail.tsx` (accept `nav` prop)
- Modify: `src/components/redesign/shell/OperatorMobileNav.tsx` (accept filtered lists)
- Modify: `src/components/redesign/command/CommandPaletteData.tsx` (filter the same way so hidden destinations don't leak)

**Interfaces:**
- Consumes: `type ManagerPermissionKey` from `@/lib/permissions/managerFlags`; `useAuth`, `useManagerPermissions`.
- Produces:
  - `NavItem` gains `requires?: ManagerPermissionKey`.
  - `filterOperatorNav(items: NavItem[], opts: { privileged: boolean; permissions: ManagerPermissions | null }): NavItem[]` (pure).
  - `useOperatorNav(): { nav: NavItem[]; primary: NavItem[]; secondary: NavItem[] }`.
  - `OperatorRail({ activeId, nav }: { activeId?: string; nav: NavItem[] })`.
  - `OperatorMobileNav({ activeId, onNewBooking, primary, secondary }: { activeId?: string; onNewBooking?: () => void; primary: NavItem[]; secondary: NavItem[] })`.

- [ ] **Step 1: Add metadata + pure filter (test first)**

`nav-items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OPERATOR_NAV, filterOperatorNav } from './nav-items';
import { emptyManagerPermissions } from '@/lib/permissions/managerFlags';

describe('filterOperatorNav', () => {
  it('privileged sees everything', () => {
    const out = filterOperatorNav(OPERATOR_NAV, { privileged: true, permissions: null });
    expect(out).toHaveLength(OPERATOR_NAV.length);
  });
  it('a manager with no flags sees only overview + settings', () => {
    const out = filterOperatorNav(OPERATOR_NAV, { privileged: false, permissions: emptyManagerPermissions() });
    expect(out.map((i) => i.id).sort()).toEqual(['overview', 'settings']);
  });
  it('a flag reveals its destination', () => {
    const perms = { ...emptyManagerPermissions(), can_view_payments: true };
    const out = filterOperatorNav(OPERATOR_NAV, { privileged: false, permissions: perms });
    expect(out.map((i) => i.id)).toContain('payments');
    expect(out.map((i) => i.id)).not.toContain('analytics');
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npm run test:unit -- src/components/redesign/shell/nav-items.test.ts`
Expected: FAIL (`filterOperatorNav` not exported).

- [ ] **Step 3: Implement metadata + filter in `nav-items.ts`**

Add `requires?: ManagerPermissionKey` to the `NavItem` type and set it on the gated items: `bookings → 'can_view_bookings'`, `people → 'can_view_customers'`, `cleaners → 'can_manage_cleaners'`, `services → 'can_view_services'`, `payments → 'can_view_payments'`, `analytics → 'can_view_analytics'`, `messages → 'can_view_messages'`. Leave `overview` and `settings` without `requires`. Append:

```ts
import type { ManagerPermissionKey, ManagerPermissions } from '@/lib/permissions/managerFlags';

export function filterOperatorNav(
  items: NavItem[],
  opts: { privileged: boolean; permissions: ManagerPermissions | null },
): NavItem[] {
  if (opts.privileged) return items;
  return items.filter((i) => !i.requires || !!opts.permissions?.[i.requires]);
}
```

- [ ] **Step 4: Build the hook**

```ts
// src/components/redesign/shell/useOperatorNav.ts
'use client';
import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { OPERATOR_NAV, filterOperatorNav, type NavItem } from './nav-items';

export function useOperatorNav(): { nav: NavItem[]; primary: NavItem[]; secondary: NavItem[] } {
  const { currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  return useMemo(() => {
    const nav = filterOperatorNav(OPERATOR_NAV, { privileged, permissions });
    return {
      nav,
      primary: nav.filter((i) => i.primary),
      secondary: nav.filter((i) => !i.primary && i.id !== 'settings'),
    };
  }, [privileged, permissions]);
}
```

- [ ] **Step 5: Thread through the shell**

- `OperatorShell.tsx`: call `const { nav, primary, secondary } = useOperatorNav();`, pass `nav` to `<OperatorRail nav={nav} activeId={activeId} />` and `primary`/`secondary` to `<OperatorMobileNav primary={primary} secondary={secondary} activeId={activeId} onNewBooking={onNewBooking} />`. Keep `deriveActive` using the full `OPERATOR_NAV` (so active highlighting still resolves even for the settings alias).
- `OperatorRail.tsx`: accept `nav: NavItem[]` and map `nav` instead of `OPERATOR_NAV` (line ~53). Keep the `item.id === 'settings' && 'mt-auto'` anchor (settings is never filtered).
- `OperatorMobileNav.tsx`: accept `primary`/`secondary` props and use them in the bottom bar (line ~48) and the drawer groups (lines ~102/106); keep the module-level `SETTINGS` const for the drawer footer.

- [ ] **Step 6: Filter the command palette**

In `CommandPaletteData.tsx` (~line 149) where it maps `OPERATOR_NAV`, use `useOperatorNav().nav` instead so a manager's palette doesn't list hidden destinations.

- [ ] **Step 7: Verify**

Run: `npm run test:unit -- src/components/redesign/shell/nav-items.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/redesign/shell/nav-items.ts src/components/redesign/shell/nav-items.test.ts src/components/redesign/shell/useOperatorNav.ts src/components/redesign/shell/OperatorShell.tsx src/components/redesign/shell/OperatorRail.tsx src/components/redesign/shell/OperatorMobileNav.tsx src/components/redesign/command/CommandPaletteData.tsx
git commit -m "feat(redesign): permission-filtered Operator navigation for managers"
```

---

## Task 3: Per-route redirect guard for forbidden tabs

**Files:**
- Create: `src/lib/redesign/useRequireManagerFlag.ts`
- Modify: each gated sub-route page under `src/app/(redesign)/app/admin-dashboard/*` (bookings, customers, cleaners, services, payments, analytics, messages)

**Interfaces:**
- Consumes: `useAuth` (`currentOrgRole`), `useManagerPermissions`, `type ManagerPermissionKey`.
- Produces: `useRequireManagerFlag(flag: ManagerPermissionKey): 'checking' | 'allowed'` — redirects a manager who lacks `flag` to `/app/admin-dashboard`; returns `'checking'` until permissions load so the page can render a spinner and never flash forbidden data.

- [ ] **Step 1: Build the hook**

```ts
// src/lib/redesign/useRequireManagerFlag.ts
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import type { ManagerPermissionKey } from '@/lib/permissions/managerFlags';

export function useRequireManagerFlag(flag: ManagerPermissionKey): 'checking' | 'allowed' {
  const router = useRouter();
  const { currentOrgRole } = useAuth();
  const { permissions, loading } = useManagerPermissions();
  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const allowed = privileged || !!permissions?.[flag];

  useEffect(() => {
    if (privileged) return;
    if (loading) return; // wait for the permission row
    if (!permissions?.[flag]) router.replace('/app/admin-dashboard');
  }, [privileged, loading, permissions, flag, router]);

  if (privileged) return 'allowed';
  if (loading) return 'checking';
  return allowed ? 'allowed' : 'checking';
}
```

- [ ] **Step 2: Insert into each gated page**

In each page (e.g. `payments/page.tsx`), after the existing org-load guard block, add the flag guard and short-circuit the render while checking. Example for `payments/page.tsx`:

```tsx
const flagState = useRequireManagerFlag('can_view_payments');
// ...after the existing `if (!user) ... / orgStatus` guards:
if (flagState === 'checking') return <Spinner />; // reuse the same Spinner the page already imports for org load
```

Apply with the flag from the nav map: bookings→`can_view_bookings`, customers→`can_view_customers`, cleaners→`can_manage_cleaners`, services→`can_view_services`, payments→`can_view_payments`, analytics→`can_view_analytics`, messages→`can_view_messages`. Do NOT add a guard to `settings/page.tsx` or the overview `page.tsx`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.
Run the app; sign in as a manager missing `can_view_payments`, navigate directly to `/app/admin-dashboard/payments` → redirected to Overview (no flash). Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/lib/redesign/useRequireManagerFlag.ts "src/app/(redesign)/app/admin-dashboard/bookings/page.tsx" "src/app/(redesign)/app/admin-dashboard/customers/page.tsx" "src/app/(redesign)/app/admin-dashboard/cleaners/page.tsx" "src/app/(redesign)/app/admin-dashboard/services/page.tsx" "src/app/(redesign)/app/admin-dashboard/payments/page.tsx" "src/app/(redesign)/app/admin-dashboard/analytics/page.tsx" "src/app/(redesign)/app/admin-dashboard/messages/page.tsx"
git commit -m "feat(redesign): redirect managers away from forbidden Operator tabs"
```

---

## Task 4: Stripped-down manager Overview hero + drop-and-reflow KPI strip

**Files:**
- Modify: `src/components/redesign/overview/OperatorOverview.tsx`
- Modify: `src/components/redesign/overview/KpiStrip.tsx`
- Modify: `src/components/redesign/overview/overview-types.ts`

**Interfaces:**
- Consumes: existing `privileged` / `canViewPayments` computed in `OperatorOverview`.
- Produces: KPI strip renders the Revenue tile only when `canViewPayments`, dropping it (grid reflows) otherwise; the ad-hoc revenue→Unassigned swap is removed. Manager hero omits owner-only chrome.

- [ ] **Step 1: KPI strip — drop instead of swap (test the pure helper if extracted, else visual)**

In `KpiStrip.tsx`, replace the 4th-tile ternary (Revenue vs Unassigned) with a conditional render: render the Revenue `StatTile` only when `kpis.canViewPayments && kpis.revenueThisMonth != null`; otherwise render nothing for that slot (do NOT substitute the Unassigned tile). Ensure the strip container is a reflowing grid (e.g. the existing responsive grid classes) so 3 tiles lay out cleanly. Remove the now-dead `unassignedCount` usage in this component.

- [ ] **Step 2: overview-types — keep the contract minimal**

`unassignedCount` may remain on `OverviewKpis` (still computed upstream) but is no longer consumed by `KpiStrip`; if it becomes entirely unused across the codebase, remove it from `overview-types.ts` and `OperatorOverview.tsx` to keep the contract honest. Leave `canViewPayments` + `revenueThisMonth` as the revenue gate.

- [ ] **Step 3: Manager hero variant**

In `OperatorOverview.tsx`, the hero already suppresses owner onboarding (`showOnboarding = currentOrgRole === 'owner'`). Add a `privileged`-aware hero: for a non-privileged manager, render the compact greeting + today summary + the `can_edit_bookings`-gated "New booking" CTA, and omit any company-wide revenue banner/owner setup chrome. Reuse the existing hero subcomponent/props; pass a `variant` or simply gate the revenue-bearing hero elements on `canViewPayments`. Keep admins' hero unchanged.

- [ ] **Step 4: Verify (visual)**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.
Run the app as (a) an admin and (b) a manager without payments; confirm the admin Overview is unchanged and the manager Overview shows the stripped hero + a reflowed KPI strip with no Revenue tile and no locked/placeholder tile. Run the `ui-ux-pro-max` implementation-phase check (design-system conformance). Screenshot both.

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/overview/OperatorOverview.tsx src/components/redesign/overview/KpiStrip.tsx src/components/redesign/overview/overview-types.ts
git commit -m "feat(redesign): stripped-down manager Overview hero + drop-and-reflow KPI strip"
```

---

## Task 5: Component-level gating audit across the Operator screens

**Files:**
- Modify (as needed): `src/components/redesign/{bookings,customers,cleaners,services,payments,analytics,messages}/*` action controls
- Reference: `src/lib/permissions/managerFlags.ts` (the registry) + the nav→flag map above

**Interfaces:** none new — this task verifies existing screens honor the registry.

- [ ] **Step 1: Audit each screen against the registry**

For each Operator screen, confirm that action controls (not just tab visibility) gate on the correct flag using the `privileged || permissions?.flag` idiom, matching the enforcement now in place server-side:
- Bookings: create/edit/cancel gated on `can_edit_bookings`; approve/decline + assign on `can_handle_requests`.
- Customers: edit/invite on `can_edit_customers`.
- Services: create/edit on `can_manage_services`.
- Properties (in customers/property views): edit on `can_edit_properties`.
- Payments: any spend/record/invoice/payout action on `can_manage_payments`; view on `can_view_payments`.
- Cleaners: manage actions on `can_manage_cleaners`.
Fix any control that is visible/enabled to a manager lacking the flag (defense-in-depth over the server guard, which will now 403 anyway).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: clean/PASS.
Sign in as a manager with a restrictive permission set; walk each screen confirming forbidden actions are hidden/disabled and permitted ones work. Screenshot a representative screen.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(redesign): gate Operator screen actions by manager permissions"
```

---

## Final gate (whole plan)

- [ ] `npm run test`, `npx tsc --noEmit`, `npm run lint` green.
- [ ] With `NEXT_PUBLIC_REDESIGN_ENABLED=true`, a manager lands on `/app/admin-dashboard`, sees only permitted nav destinations (rail, mobile, command palette), is redirected to Overview on a forbidden direct URL, sees a stripped hero + reflowed KPI strip, and cannot trigger forbidden actions.
- [ ] Admin experience is unchanged.
- [ ] With the flag off, managers still reach legacy `/manager-dashboard`.

## Self-Review

- **Spec coverage (Part D):** routing → Task 1; permission-filtered nav → Task 2; per-route redirect guard → Task 3; stripped hero + drop-reflow KPI → Task 4; component-level gating audit → Task 5.
- **Type consistency:** `filterOperatorNav`, `useOperatorNav`, `useRequireManagerFlag`, `NavItem.requires`, the nav→flag map, and `privileged || permissions?.flag` are used identically across tasks and match the `ManagerPermissionKey` from the enforcement plan.
- **Known confirm-at-impl items:** the exact Spinner/loading component each sub-page already imports (reuse it in the guard short-circuit); whether `unassignedCount` is used anywhere else before removing it; the exact hero subcomponent/prop name in `OperatorOverview` for the manager variant.
