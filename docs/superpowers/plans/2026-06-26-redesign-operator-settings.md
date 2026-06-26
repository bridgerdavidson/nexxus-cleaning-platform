# Redesign Operator Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a redesign-native operator Settings experience — a nested "quiet left index" inside the operator shell, with native-row section bodies, explicit save, and a Save/Discard/Keep-editing leave guard — reusing the headless per-section save logic and the owned primitive kit.

**Architecture:** A single flag-gated `(redesign)` route renders `OperatorShell active="settings"` around an `OperatorSettings` container. The container resolves role/permissions, computes the visible section list from a **redesign-owned** registry (legacy `src/lib/settings.ts` is never touched), tracks the active section in the URL (`?section=`), and guards section switches when the active section is dirty. Each section is a self-contained component that loads/saves through existing PATCH routes and reports its dirty state + save handler up to the container via a context. Mirrors the established operator-screen pattern (Container → pure View → pure derive + Vitest; `(dev)` preview; Playwright verify; Codex pre-push).

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript, Tailwind v3 + the owned primitive kit (`src/components/ui/*`), Radix primitives, Vitest (pure unit tests), Playwright MCP (UI verification), Supabase JS client (reads), existing org PATCH API routes (writes).

## Global Constraints

- **Worktree:** all work in `.claude/worktrees/redesign-settings` on branch `feat/redesign-operator-settings` (off `master`). `npm install` already run; `.env.development.local` already copied.
- **Flag / route group:** new screen lives under `src/app/(redesign)/app/admin-dashboard/settings/` — inherits the `(redesign)/layout.tsx` gate (`process.env.NODE_ENV !== 'production' || VERCEL_ENV === 'preview' || redesignUiEnabled()` where `redesignUiEnabled()` = `process.env.NEXT_PUBLIC_REDESIGN_ENABLED === 'true'`). **No per-page gate needed.**
- **Legacy is never edited:** do NOT modify `src/app/settings/*`, `src/components/settings/*`, or `src/lib/settings.ts`. The redesign gets its own registry.
- **Reuse existing writes — no new API routes, no migrations:** `PATCH /api/organizations/[orgId]/profile` (org name/logo/billing_email + default_payout_model), `.../payment-settings` (cancellation policy), `.../business-hours`, `.../cleaner-payouts` (default %); profile fields via `useAuth().updateProfile`.
- **Visual source of truth = the primitive kit + design tokens.** The brainstorm mockup is structure-only; do not copy its ad-hoc colors/markers. No "owner" pills (role-scoping already hides owner-only sections). Brand `#0150FC`; font Plus Jakarta Sans (inherited from the redesign layout).
- **No em dashes** in any user-facing copy (labels, helper text, toasts, dialog copy).
- **Section list (operator), role-scoped:** Account = Profile (all), Organization (owner) · Business = Payments (owner/admin, manager+`can_manage_payments`), Cancellation policy (owner/admin, manager+`can_manage_payments`), Payout settings (owner — merged model + default %), Business hours (owner/admin, manager+`can_manage_cleaners`).
- **Default landing:** Profile, for every role. **Entry points:** the existing rail gear (repointed) + the top-bar profile dropdown "Settings" link.
- **Save model:** explicit save; dirty-only save bar; success toast on save (`showToast(msg, { variant: 'success' })`); a three-way Save / Discard / Keep-editing dialog when leaving a dirty section.
- **Tests:** pure logic via Vitest (`npx vitest run <file>`); UI via Playwright MCP against the `(dev)` preview and live dev Supabase. Follow the redesign convention (pure-unit + Playwright), not component-render tests.

---

## File Structure

**Create (all under the worktree):**
- `src/components/redesign/settings/sections.ts` — redesign registry + `deriveSettingsSections` + `DEFAULT_SETTINGS_SECTION` (pure).
- `src/components/redesign/settings/sections.test.ts` — unit tests for the above.
- `src/components/redesign/settings/settings-api.ts` — thin PATCH helpers wrapping the existing org routes.
- `src/components/redesign/settings/useSettingsSection.ts` — shared load/save/dirty/toast/guard hook + `isFormDirty` (pure).
- `src/components/redesign/settings/useSettingsSection.test.ts` — unit test for `isFormDirty`.
- `src/components/redesign/settings/SettingsNavGuard.tsx` — context + `useRegisterSettingsGuard`.
- `src/components/redesign/settings/SettingRow.tsx` — native label-left / control-right row.
- `src/components/redesign/settings/SettingsSaveBar.tsx` — dirty-only sticky save bar.
- `src/components/redesign/settings/SettingsLeaveDialog.tsx` — three-way Save/Discard/Keep-editing dialog.
- `src/components/redesign/settings/OperatorSettings.tsx` — container (gate, active-section URL state, nav guard).
- `src/components/redesign/settings/OperatorSettingsView.tsx` — pure View (quiet left index + body slot).
- `src/components/redesign/settings/sections/registry.ts` — `SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType>`.
- `src/components/redesign/settings/sections/ProfileSection.tsx`
- `src/components/redesign/settings/sections/OrganizationSection.tsx`
- `src/components/redesign/settings/sections/PaymentsSection.tsx`
- `src/components/redesign/settings/sections/CancellationSection.tsx`
- `src/components/redesign/settings/sections/PayoutSettingsSection.tsx`
- `src/components/redesign/settings/sections/BusinessHoursSection.tsx`
- `src/app/(redesign)/app/admin-dashboard/settings/page.tsx` — Suspense wrapper + shell.
- `src/app/(dev)/settings-preview/page.tsx` — presentational sandbox.

**Modify:**
- `src/components/redesign/shell/nav-items.ts` — repoint settings `href`; add `activeFor`.
- `src/components/redesign/shell/OperatorShell.tsx` — `deriveActive` honors `activeFor`.
- `src/components/redesign/shell/OperatorTopBar.tsx` — make the dropdown "Settings" item a real `Link`.

---

## Task 1: Redesign settings registry + `deriveSettingsSections`

**Files:**
- Create: `src/components/redesign/settings/sections.ts`
- Test: `src/components/redesign/settings/sections.test.ts`

**Interfaces:**
- Produces: `type SettingsSectionId = 'profile'|'organization'|'payments'|'cancellation'|'payout'|'business-hours'`; `type SettingsGroupId = 'account'|'business'`; `interface RedesignSettingsSection { id: SettingsSectionId; label: string; icon: LucideIcon; group: SettingsGroupId; roles?: string[]; managerPermission?: keyof ManagerPermissions }`; `REDESIGN_SETTINGS_SECTIONS: RedesignSettingsSection[]`; `REDESIGN_SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[]`; `deriveSettingsSections(role?, orgRole?, permissions?): RedesignSettingsSection[]`; `DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'profile'`; `isVisibleSection(id, role?, orgRole?, permissions?): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/redesign/settings/sections.test.ts
import { describe, expect, it } from "vitest";
import type { ManagerPermissions } from "@/hooks/useAdminData";
import { deriveSettingsSections, isVisibleSection, REDESIGN_SETTINGS_SECTIONS } from "./sections";

const NONE: ManagerPermissions = {
  can_view_customers: false, can_edit_customers: false, can_view_bookings: false,
  can_edit_bookings: false, can_approve_decline_bookings: false, can_manage_cleaners: false,
  can_view_properties: false, can_edit_properties: false, can_view_analytics: false,
  can_view_payments: false, can_manage_payments: false, can_view_messages: false,
  can_view_services: false, can_manage_services: false, can_handle_requests: false,
};
const perms = (o: Partial<ManagerPermissions> = {}): ManagerPermissions => ({ ...NONE, ...o });
const ids = (role?: string, orgRole?: string, p?: ManagerPermissions) =>
  deriveSettingsSections(role, orgRole, p).map((s) => s.id);

describe("deriveSettingsSections", () => {
  it("owner sees all six sections", () => {
    expect(ids("admin", "owner")).toEqual([
      "profile", "organization", "payments", "cancellation", "payout", "business-hours",
    ]);
  });
  it("admin does not see owner-only sections (organization, payout)", () => {
    expect(ids("admin", "admin")).toEqual(["profile", "payments", "cancellation", "business-hours"]);
  });
  it("manager with no permissions sees only Profile", () => {
    expect(ids("manager", "manager", perms())).toEqual(["profile"]);
  });
  it("manager with can_manage_payments sees payments + cancellation", () => {
    expect(ids("manager", "manager", perms({ can_manage_payments: true }))).toEqual([
      "profile", "payments", "cancellation",
    ]);
  });
  it("manager with can_manage_cleaners sees business hours", () => {
    expect(ids("manager", "manager", perms({ can_manage_cleaners: true }))).toEqual([
      "profile", "business-hours",
    ]);
  });
  it("groups every section as account or business", () => {
    expect(REDESIGN_SETTINGS_SECTIONS.every((s) => s.group === "account" || s.group === "business")).toBe(true);
  });
});

describe("isVisibleSection", () => {
  it("payout is hidden from admins", () => {
    expect(isVisibleSection("payout", "admin", "admin")).toBe(false);
  });
  it("payout is visible to owners", () => {
    expect(isVisibleSection("payout", "admin", "owner")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/redesign/settings/sections.test.ts`
Expected: FAIL — cannot resolve `./sections`.

- [ ] **Step 3: Write the implementation**

```ts
// src/components/redesign/settings/sections.ts
import { User, Building2, CreditCard, Receipt, Wallet, CalendarClock, type LucideIcon } from "lucide-react";
import type { ManagerPermissions } from "@/hooks/useAdminData";

export type SettingsSectionId =
  | "profile" | "organization" | "payments" | "cancellation" | "payout" | "business-hours";
export type SettingsGroupId = "account" | "business";

export interface RedesignSettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  group: SettingsGroupId;
  /** UserRole/OrgRole strings allowed to see this section; undefined = visible to all. */
  roles?: string[];
  /** Required only when orgRole === 'manager'. Other roles bypass. */
  managerPermission?: keyof ManagerPermissions;
}

export const REDESIGN_SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "business", label: "Business" },
];

export const REDESIGN_SETTINGS_SECTIONS: RedesignSettingsSection[] = [
  { id: "profile", label: "Profile", icon: User, group: "account" },
  { id: "organization", label: "Organization", icon: Building2, group: "account", roles: ["owner"] },
  { id: "payments", label: "Payments", icon: CreditCard, group: "business", roles: ["admin", "owner", "manager"], managerPermission: "can_manage_payments" },
  { id: "cancellation", label: "Cancellation policy", icon: Receipt, group: "business", roles: ["admin", "owner", "manager"], managerPermission: "can_manage_payments" },
  { id: "payout", label: "Payout settings", icon: Wallet, group: "business", roles: ["owner"] },
  { id: "business-hours", label: "Business hours", icon: CalendarClock, group: "business", roles: ["admin", "owner", "manager"], managerPermission: "can_manage_cleaners" },
];

/** Mirrors src/lib/settings.ts getSectionsForRole: additive role match, manager narrowed by permission. */
export function deriveSettingsSections(
  role?: string,
  orgRole?: string,
  permissions?: ManagerPermissions | null,
): RedesignSettingsSection[] {
  const roles = [role, orgRole].filter((r): r is string => !!r);
  return REDESIGN_SETTINGS_SECTIONS.filter((section) => {
    if (section.roles && !section.roles.some((r) => roles.includes(r))) return false;
    if (orgRole === "manager" && section.managerPermission) {
      if (!permissions || !permissions[section.managerPermission]) return false;
    }
    return true;
  });
}

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "profile";

export function isVisibleSection(
  id: string,
  role?: string,
  orgRole?: string,
  permissions?: ManagerPermissions | null,
): id is SettingsSectionId {
  return deriveSettingsSections(role, orgRole, permissions).some((s) => s.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/redesign/settings/sections.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/settings/sections.ts src/components/redesign/settings/sections.test.ts
git commit -m "feat(redesign-settings): role-scoped section registry + deriveSettingsSections"
```

---

## Task 2: Shared settings toolkit (api, dirty hook, row, save bar, leave dialog, nav guard)

**Files:**
- Create: `src/components/redesign/settings/settings-api.ts`
- Create: `src/components/redesign/settings/SettingsNavGuard.tsx`
- Create: `src/components/redesign/settings/useSettingsSection.ts`
- Test: `src/components/redesign/settings/useSettingsSection.test.ts`
- Create: `src/components/redesign/settings/SettingRow.tsx`
- Create: `src/components/redesign/settings/SettingsSaveBar.tsx`
- Create: `src/components/redesign/settings/SettingsLeaveDialog.tsx`

**Interfaces:**
- Produces: `updateOrgProfile/updateOrgPaymentSettings/updateOrgBusinessHours/updateOrgCleanerPayouts(orgId, body)`; `isFormDirty<T>(a,b): boolean`; `useSettingsSection<T>({ load, save, successMessage }): { value, setValue, baseline, loading, saving, isDirty, loadError, onSave, onDiscard }` where `onSave(): Promise<boolean>`; `interface SettingsGuard { isDirty: boolean; save: () => Promise<boolean> }`; `SettingsNavGuardProvider({ register, children })`; `useRegisterSettingsGuard(guard: SettingsGuard): void`; `SettingRow({ label, htmlFor?, helper?, children })`; `SettingsSaveBar({ visible, saving, onSave, onDiscard })`; `SettingsLeaveDialog({ open, saving, onSave, onDiscard, onCancel })`.

- [ ] **Step 1: Write the failing test (pure dirty helper)**

```ts
// src/components/redesign/settings/useSettingsSection.test.ts
import { describe, expect, it } from "vitest";
import { isFormDirty } from "./useSettingsSection";

describe("isFormDirty", () => {
  it("is false when values are structurally equal", () => {
    expect(isFormDirty({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(false);
  });
  it("is true when a field differs", () => {
    expect(isFormDirty({ a: 1 }, { a: 2 })).toBe(true);
  });
  it("treats nested objects by value", () => {
    expect(isFormDirty({ h: { mon: "08:00" } }, { h: { mon: "08:00" } })).toBe(false);
    expect(isFormDirty({ h: { mon: "08:00" } }, { h: { mon: "09:00" } })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/redesign/settings/useSettingsSection.test.ts`
Expected: FAIL — cannot resolve `./useSettingsSection`.

- [ ] **Step 3: Write `settings-api.ts`**

```ts
// src/components/redesign/settings/settings-api.ts
import { getAccessToken } from "@/lib/auth/clientAccessToken";

async function patch(path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not save changes");
  return data;
}

export const updateOrgProfile = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/profile`, body);
export const updateOrgPaymentSettings = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/payment-settings`, body);
export const updateOrgBusinessHours = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/business-hours`, body);
export const updateOrgCleanerPayouts = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/cleaner-payouts`, body);
```

- [ ] **Step 4: Write `SettingsNavGuard.tsx`**

```tsx
// src/components/redesign/settings/SettingsNavGuard.tsx
"use client";
import { createContext, useContext, useEffect } from "react";

export interface SettingsGuard {
  isDirty: boolean;
  save: () => Promise<boolean>;
}

interface GuardCtx {
  register: (g: SettingsGuard | null) => void;
}

const Ctx = createContext<GuardCtx | null>(null);

export function SettingsNavGuardProvider({
  register,
  children,
}: {
  register: (g: SettingsGuard | null) => void;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ register }}>{children}</Ctx.Provider>;
}

/** A section calls this to expose its dirty state + save handler to the container's leave guard. */
export function useRegisterSettingsGuard(guard: SettingsGuard): void {
  const ctx = useContext(Ctx);
  useEffect(() => {
    ctx?.register(guard);
    return () => ctx?.register(null);
  }, [ctx, guard.isDirty, guard.save]);
}
```

- [ ] **Step 5: Write `useSettingsSection.ts`**

```ts
// src/components/redesign/settings/useSettingsSection.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { useRegisterSettingsGuard } from "./SettingsNavGuard";

export function isFormDirty<T>(a: T, b: T): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Shared state machine for a settings form section: load once, track a dirty baseline,
 * save explicitly (toast on success/failure), and register a leave-guard.
 * Pass `load`/`save` wrapped in useCallback so the guard does not re-register every render.
 */
export function useSettingsSection<T>(opts: {
  load: () => Promise<T>;
  save: (value: T) => Promise<void>;
  successMessage: string;
}) {
  const { load, save, successMessage } = opts;
  const { showToast } = useToast();
  const [value, setValue] = useState<T | null>(null);
  const [baseline, setBaseline] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .then((v) => { if (alive) { setValue(v); setBaseline(v); setLoading(false); } })
      .catch((e: unknown) => { if (alive) { setLoadError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { alive = false; };
  }, [load]);

  const isDirty = value != null && baseline != null && isFormDirty(value, baseline);

  const onSave = useCallback(async (): Promise<boolean> => {
    if (value == null) return false;
    setSaving(true);
    try {
      await save(value);
      setBaseline(value);
      showToast(successMessage, { variant: "success" });
      return true;
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Could not save changes", { variant: "error" });
      return false;
    } finally {
      setSaving(false);
    }
  }, [value, save, successMessage, showToast]);

  const onDiscard = useCallback(() => setValue(baseline), [baseline]);

  useRegisterSettingsGuard({ isDirty, save: onSave });

  return { value, setValue, baseline, loading, saving, isDirty, loadError, onSave, onDiscard };
}
```

- [ ] **Step 6: Run the dirty test to verify it passes**

Run: `npx vitest run src/components/redesign/settings/useSettingsSection.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Write `SettingRow.tsx`**

```tsx
// src/components/redesign/settings/SettingRow.tsx
import { Label } from "@/components/ui/label";

/** Native settings row: label + helper on the left, control on the right, hairline divider. */
export function SettingRow({
  label, htmlFor, helper, children,
}: { label: string; htmlFor?: string; helper?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-5 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="space-y-1 sm:max-w-sm">
        <Label htmlFor={htmlFor} className="text-foreground">{label}</Label>
        {helper ? <p className="text-sm text-muted-foreground">{helper}</p> : null}
      </div>
      <div className="shrink-0 sm:pt-0.5">{children}</div>
    </div>
  );
}
```

- [ ] **Step 8: Write `SettingsSaveBar.tsx`**

```tsx
// src/components/redesign/settings/SettingsSaveBar.tsx
import { Button } from "@/components/ui/button";

export function SettingsSaveBar({
  visible, saving, onSave, onDiscard,
}: { visible: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-0 -mx-6 mt-8 flex items-center gap-3 border-t border-border bg-card/90 px-6 py-3 backdrop-blur md:-mx-8 md:px-8">
      <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-caution" /> Unsaved changes
      </span>
      <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
      <Button onClick={onSave} loading={saving}>Save changes</Button>
    </div>
  );
}
```

- [ ] **Step 9: Write `SettingsLeaveDialog.tsx` (three-way)**

```tsx
// src/components/redesign/settings/SettingsLeaveDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Shown when leaving a dirty section: Save changes / Discard / Keep editing. */
export function SettingsLeaveDialog({
  open, saving, onSave, onDiscard, onCancel,
}: { open: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription>
            You have unsaved changes in this section. Save them before leaving, or discard them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Keep editing</Button>
          <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button onClick={onSave} loading={saving}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 10: Typecheck + commit**

Run: `npx tsc --noEmit` — Expected: no NEW errors in `src/components/redesign/settings/*` (pre-existing CVA `variant` widening warnings elsewhere are ignored per repo convention).

```bash
git add src/components/redesign/settings/settings-api.ts src/components/redesign/settings/SettingsNavGuard.tsx src/components/redesign/settings/useSettingsSection.ts src/components/redesign/settings/useSettingsSection.test.ts src/components/redesign/settings/SettingRow.tsx src/components/redesign/settings/SettingsSaveBar.tsx src/components/redesign/settings/SettingsLeaveDialog.tsx
git commit -m "feat(redesign-settings): shared form toolkit (api, dirty hook, row, save bar, leave dialog, nav guard)"
```

---

## Task 3: Shell wiring — repoint the Settings gear + working top-bar link

**Files:**
- Modify: `src/components/redesign/shell/nav-items.ts`
- Modify: `src/components/redesign/shell/OperatorShell.tsx`
- Modify: `src/components/redesign/shell/OperatorTopBar.tsx`

**Interfaces:**
- Consumes: existing `OPERATOR_NAV`, `deriveActive`.
- Produces: `NavItem.activeFor?: string[]`; settings nav item `href: "/app/admin-dashboard/settings"` with `activeFor: ["/settings"]`; `deriveActive` honors `activeFor`.

- [ ] **Step 1: Add `activeFor` to `NavItem` and repoint the settings entry**

In `src/components/redesign/shell/nav-items.ts`, extend the type and the settings item:

```ts
export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  primary?: boolean;
  /** Extra path roots that should also mark this item active (incremental rollout aliasing). */
  activeFor?: string[];
};
```

Change the settings entry (currently `href: "/settings"`):

```ts
{ id: "settings", label: "Settings", href: "/app/admin-dashboard/settings", icon: Settings, activeFor: ["/settings"] },
```

- [ ] **Step 2: Teach `deriveActive` to honor `activeFor`**

In `src/components/redesign/shell/OperatorShell.tsx`, replace the `deriveActive` loop body:

```tsx
function deriveActive(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  let best: { id: string; len: number } | undefined;
  for (const item of OPERATOR_NAV) {
    const roots = [item.href, ...(item.activeFor ?? [])];
    for (const root of roots) {
      if (pathname === root || pathname.startsWith(root + "/")) {
        if (!best || root.length > best.len) best = { id: item.id, len: root.length };
      }
    }
  }
  return best?.id;
}
```

- [ ] **Step 3: Make the top-bar profile "Settings" item navigate**

In `src/components/redesign/shell/OperatorTopBar.tsx`, add `import Link from "next/link";` and replace the inert `<DropdownMenuItem>Settings</DropdownMenuItem>`:

```tsx
<DropdownMenuItem asChild>
  <Link href="/app/admin-dashboard/settings">Settings</Link>
</DropdownMenuItem>
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (No unit test — behavior is verified in the Task 4 Playwright pass: the gear lights up on `/app/admin-dashboard/settings` and the profile menu navigates.)

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/shell/nav-items.ts src/components/redesign/shell/OperatorShell.tsx src/components/redesign/shell/OperatorTopBar.tsx
git commit -m "feat(redesign-settings): repoint operator Settings gear + wire top-bar profile link"
```

---

## Task 4: Settings shell — route, container, pure View, section stubs, dev preview

**Files:**
- Create: `src/components/redesign/settings/OperatorSettings.tsx`
- Create: `src/components/redesign/settings/OperatorSettingsView.tsx`
- Create: `src/components/redesign/settings/sections/registry.ts`
- Create stubs: `sections/{ProfileSection,OrganizationSection,PaymentsSection,CancellationSection,PayoutSettingsSection,BusinessHoursSection}.tsx`
- Create: `src/app/(redesign)/app/admin-dashboard/settings/page.tsx`
- Create: `src/app/(dev)/settings-preview/page.tsx`

**Interfaces:**
- Consumes: `deriveSettingsSections`, `DEFAULT_SETTINGS_SECTION`, `REDESIGN_SETTINGS_GROUPS`, `SettingsNavGuardProvider`, `SettingsLeaveDialog`, `SettingsGuard`, `useAuth`, `useManagerPermissions`.
- Produces: `OperatorSettings` (container, default export of the screen tree), `OperatorSettingsView({ sections, activeId, onSelectSection, children })`, `SECTION_COMPONENTS`.

- [ ] **Step 1: Write the section stubs**

For each of the six section files (`ProfileSection`, `OrganizationSection`, `PaymentsSection`, `CancellationSection`, `PayoutSettingsSection`, `BusinessHoursSection`), create a placeholder so the registry compiles. Example (`sections/ProfileSection.tsx`):

```tsx
// src/components/redesign/settings/sections/ProfileSection.tsx
"use client";
export function ProfileSection() {
  return <p className="text-sm text-muted-foreground">Profile settings coming in a later task.</p>;
}
```

Repeat verbatim for `OrganizationSection`, `PaymentsSection`, `CancellationSection`, `PayoutSettingsSection`, `BusinessHoursSection` (change the component name + the word in the sentence).

- [ ] **Step 2: Write the section registry**

```ts
// src/components/redesign/settings/sections/registry.ts
import type { ComponentType } from "react";
import type { SettingsSectionId } from "../sections";
import { ProfileSection } from "./ProfileSection";
import { OrganizationSection } from "./OrganizationSection";
import { PaymentsSection } from "./PaymentsSection";
import { CancellationSection } from "./CancellationSection";
import { PayoutSettingsSection } from "./PayoutSettingsSection";
import { BusinessHoursSection } from "./BusinessHoursSection";

export const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  profile: ProfileSection,
  organization: OrganizationSection,
  payments: PaymentsSection,
  cancellation: CancellationSection,
  payout: PayoutSettingsSection,
  "business-hours": BusinessHoursSection,
};
```

- [ ] **Step 3: Write the pure View (quiet left index + body slot)**

```tsx
// src/components/redesign/settings/OperatorSettingsView.tsx
"use client";
import { cn } from "@/lib/utils";
import { REDESIGN_SETTINGS_GROUPS, type RedesignSettingsSection, type SettingsSectionId } from "./sections";

export function OperatorSettingsView({
  sections, activeId, onSelectSection, children,
}: {
  sections: RedesignSettingsSection[];
  activeId: SettingsSectionId;
  onSelectSection: (id: SettingsSectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[1700px] space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
      </header>
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft-sm md:flex">
        <SettingsIndex sections={sections} activeId={activeId} onSelect={onSelectSection} />
        <div className="min-w-0 flex-1 px-6 py-6 md:px-8 md:py-7">{children}</div>
      </div>
    </div>
  );
}

function SettingsIndex({
  sections, activeId, onSelect,
}: {
  sections: RedesignSettingsSection[];
  activeId: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}) {
  return (
    <nav aria-label="Settings sections" className="border-b border-border p-3 md:w-60 md:shrink-0 md:border-b-0 md:border-r md:p-4">
      {REDESIGN_SETTINGS_GROUPS.map((group) => {
        const items = sections.filter((s) => s.group === group.id);
        if (!items.length) return null;
        return (
          <div key={group.id} className="mb-2 last:mb-0">
            <p className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{group.label}</p>
            <ul className="space-y-0.5">
              {items.map((section) => {
                const Icon = section.icon;
                const active = section.id === activeId;
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(section.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm font-medium transition-colors",
                        active ? "bg-brand-50 text-brand-700" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-brand-600" : "text-muted-foreground")} />
                      <span className="truncate">{section.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Write the container**

```tsx
// src/components/redesign/settings/OperatorSettings.tsx
"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { EmptyState } from "@/components/ui/empty-state";
import { deriveSettingsSections, DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from "./sections";
import { SettingsNavGuardProvider, type SettingsGuard } from "./SettingsNavGuard";
import { SettingsLeaveDialog } from "./SettingsLeaveDialog";
import { OperatorSettingsView } from "./OperatorSettingsView";
import { SECTION_COMPONENTS } from "./sections/registry";

export function OperatorSettings() {
  const { user, currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sections = useMemo(
    () => deriveSettingsSections(user?.role, currentOrgRole ?? undefined, permissions),
    [user?.role, currentOrgRole, permissions],
  );

  const requested = searchParams.get("section");
  const activeId: SettingsSectionId = sections.some((s) => s.id === requested)
    ? (requested as SettingsSectionId)
    : DEFAULT_SETTINGS_SECTION;

  const guardRef = useRef<SettingsGuard | null>(null);
  const register = useCallback((g: SettingsGuard | null) => { guardRef.current = g; }, []);
  const [pending, setPending] = useState<SettingsSectionId | null>(null);
  const [savingLeave, setSavingLeave] = useState(false);

  const navigateTo = useCallback((id: SettingsSectionId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", id);
    router.replace(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  const onSelectSection = useCallback((id: SettingsSectionId) => {
    if (id === activeId) return;
    if (guardRef.current?.isDirty) { setPending(id); return; }
    navigateTo(id);
  }, [activeId, navigateTo]);

  const confirmSave = useCallback(async () => {
    setSavingLeave(true);
    const ok = await guardRef.current?.save();
    setSavingLeave(false);
    if (ok && pending) { navigateTo(pending); setPending(null); }
  }, [pending, navigateTo]);
  const confirmDiscard = useCallback(() => { if (pending) navigateTo(pending); setPending(null); }, [pending, navigateTo]);
  const cancelLeave = useCallback(() => setPending(null), []);

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  if (!privileged && permsLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (sections.length === 0) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <EmptyState icon={<ShieldAlert />} title="No settings available" description="Ask an owner or admin for access." />
      </div>
    );
  }

  const ActiveSection = SECTION_COMPONENTS[activeId];

  return (
    <SettingsNavGuardProvider register={register}>
      <OperatorSettingsView sections={sections} activeId={activeId} onSelectSection={onSelectSection}>
        <ActiveSection />
      </OperatorSettingsView>
      <SettingsLeaveDialog
        open={pending != null}
        saving={savingLeave}
        onSave={confirmSave}
        onDiscard={confirmDiscard}
        onCancel={cancelLeave}
      />
    </SettingsNavGuardProvider>
  );
}
```

- [ ] **Step 5: Write the route page**

```tsx
// src/app/(redesign)/app/admin-dashboard/settings/page.tsx
"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorSettings } from "@/components/redesign/settings/OperatorSettings";

function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function OperatorSettingsInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;

  const goNewBooking = () => router.push("/admin-dashboard?tab=bookings");

  return (
    <OperatorShell active="settings" onNewBooking={goNewBooking}>
      <OperatorSettings />
    </OperatorShell>
  );
}

export default function OperatorSettingsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorSettingsInner />
    </Suspense>
  );
}
```

> Note: confirm the exact `orgStatus` sentinel values against `src/app/(redesign)/app/admin-dashboard/customers/page.tsx` while implementing (the customers page uses `orgStatus === "idle" || "loading"` / `"error"`); copy whatever that file uses verbatim so the guard matches the rest of the redesign.

- [ ] **Step 6: Write the dev preview**

```tsx
// src/app/(dev)/settings-preview/page.tsx
"use client";
import { useState } from "react";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorSettingsView } from "@/components/redesign/settings/OperatorSettingsView";
import { REDESIGN_SETTINGS_SECTIONS, type SettingsSectionId } from "@/components/redesign/settings/sections";

export default function SettingsPreviewPage() {
  const [activeId, setActiveId] = useState<SettingsSectionId>("profile");
  const active = REDESIGN_SETTINGS_SECTIONS.find((s) => s.id === activeId)!;
  return (
    <OperatorShell active="settings" onNewBooking={() => {}}>
      <OperatorSettingsView sections={REDESIGN_SETTINGS_SECTIONS} activeId={activeId} onSelectSection={setActiveId}>
        <div>
          <h2 className="text-lg font-bold text-foreground">{active.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Preview body for the {active.label} section.</p>
        </div>
      </OperatorSettingsView>
    </OperatorShell>
  );
}
```

- [ ] **Step 7: Typecheck + Playwright verify the shell**

Run: `npx tsc --noEmit` (no new errors).
Start the dev server in the worktree: `npm run dev` (port 3000) — or `npx next dev -p 3100`.
Via Playwright MCP: open `http://localhost:3100/settings-preview`. Verify: the operator rail shows with the **gear active**; the "Settings" h1; the **quiet left index** (Account: Profile, Organization; Business: Payments, Cancellation policy, Payout settings, Business hours) with grouped labels; clicking each item switches the body title; no "Back to dashboard" anywhere. Take a desktop + mobile screenshot.

- [ ] **Step 8: Commit**

```bash
git add src/components/redesign/settings/OperatorSettings.tsx src/components/redesign/settings/OperatorSettingsView.tsx src/components/redesign/settings/sections/ src/app/(redesign)/app/admin-dashboard/settings/page.tsx "src/app/(dev)/settings-preview/page.tsx"
git commit -m "feat(redesign-settings): nested settings shell (quiet left index) + route + dev preview"
```

---

## Task 5: Profile section

**Files:**
- Modify: `src/components/redesign/settings/sections/ProfileSection.tsx`

**Interfaces:**
- Consumes: `useSettingsSection`, `SettingRow`, `SettingsSaveBar`, `useAuth().updateProfile`, `@/components/AvatarUpload`, `@/lib/phone`.
- Loads from `useAuth().user.profile`; saves via `updateProfile({ firstName, lastName, phone })`.

- [ ] **Step 1: Implement ProfileSection**

```tsx
// src/components/redesign/settings/sections/ProfileSection.tsx
"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import AvatarUpload from "@/components/AvatarUpload";
import { Input } from "@/components/ui/input";
import { formatPhoneDisplay, normalizePhoneToDigits } from "@/lib/phone";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

interface ProfileForm { firstName: string; lastName: string; phone: string }

export function ProfileSection() {
  const { user, updateProfile } = useAuth();

  const load = useCallback(async (): Promise<ProfileForm> => ({
    firstName: user?.profile.firstName ?? "",
    lastName: user?.profile.lastName ?? "",
    phone: normalizePhoneToDigits(user?.profile.phone ?? ""),
  }), [user?.profile.firstName, user?.profile.lastName, user?.profile.phone]);

  const save = useCallback(async (v: ProfileForm) => {
    const res = await updateProfile({ firstName: v.firstName, lastName: v.lastName, phone: v.phone });
    if (res.error) throw new Error(res.error);
  }, [updateProfile]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<ProfileForm>({ load, save, successMessage: "Profile updated" });

  if (loading || !value) return <SectionSkeleton />;

  return (
    <div>
      <SectionHeader title="Profile" lead="Your personal account details." />
      <SettingRow label="Profile photo" helper="PNG or JPG, at least 200x200.">
        <AvatarUpload
          currentAvatarUrl={user?.profile.avatarUrl}
          onUploadSuccess={(url) => updateProfile({ avatarUrl: url })}
          size="lg"
        />
      </SettingRow>
      <SettingRow label="First name" htmlFor="profile-first">
        <Input id="profile-first" className="sm:w-64" value={value.firstName}
          onChange={(e) => setValue({ ...value, firstName: e.target.value })} />
      </SettingRow>
      <SettingRow label="Last name" htmlFor="profile-last">
        <Input id="profile-last" className="sm:w-64" value={value.lastName}
          onChange={(e) => setValue({ ...value, lastName: e.target.value })} />
      </SettingRow>
      <SettingRow label="Phone" htmlFor="profile-phone">
        <Input id="profile-phone" className="sm:w-64" inputMode="tel" value={formatPhoneDisplay(value.phone)}
          onChange={(e) => setValue({ ...value, phone: normalizePhoneToDigits(e.target.value) })} />
      </SettingRow>
      <SettingRow label="Email" helper="Used for sign-in. Contact support to change it.">
        <span className="text-sm text-muted-foreground">{user?.email}</span>
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
```

Add two small local helpers shared by all section files — define them once in `src/components/redesign/settings/SettingRow.tsx` and export, then import where used (avoids repeating markup):

```tsx
// append to SettingRow.tsx
import { Skeleton } from "@/components/ui/skeleton";
export function SectionHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
    </div>
  );
}
export function SectionSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
```

Import them in ProfileSection: `import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";`

> While implementing, confirm `AvatarUpload`'s default vs named export and the exact `updateProfile` return type by reading `src/components/AvatarUpload.tsx` and `src/contexts/AuthContext.tsx` (research shows `updateProfile(updates): Promise<{ error?: string }>` and `AvatarUpload` props `currentAvatarUrl`, `onUploadSuccess(url)`, `size`).

- [ ] **Step 2: Typecheck + Playwright verify (live)**

Run: `npx tsc --noEmit`.
Log in to the dev app as the owner (real dev Supabase) and open `/app/admin-dashboard/settings`. Verify Profile loads name/email/phone; editing a field reveals the save bar; Save shows the success toast and clears the bar; Discard reverts. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/settings/sections/ProfileSection.tsx src/components/redesign/settings/SettingRow.tsx
git commit -m "feat(redesign-settings): Profile section"
```

---

## Task 6: Organization section (owner)

**Files:**
- Modify: `src/components/redesign/settings/sections/OrganizationSection.tsx`

**Interfaces:**
- Loads `name, logo_url, billing_email` from `supabase.from('organizations')`; saves via `updateOrgProfile(orgId, { name, logo_url, billing_email })`.

- [ ] **Step 1: Implement OrganizationSection**

```tsx
// src/components/redesign/settings/sections/OrganizationSection.tsx
"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { updateOrgProfile } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

interface OrgForm { name: string; logoUrl: string; billingEmail: string }

export function OrganizationSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<OrgForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("name, logo_url, billing_email")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      name: data?.name ?? "",
      logoUrl: (data?.logo_url as string | null) ?? "",
      billingEmail: (data?.billing_email as string | null) ?? "",
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: OrgForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgProfile(currentOrganizationId, {
      name: v.name.trim(),
      logo_url: v.logoUrl.trim() || null,
      billing_email: v.billingEmail.trim() || null,
    });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<OrgForm>({ load, save, successMessage: "Organization updated" });

  if (loading || !value) return <SectionSkeleton />;

  return (
    <div>
      <SectionHeader title="Organization" lead="How your cleaning company shows up across the app." />
      <SettingRow label="Company name" htmlFor="org-name" helper="Shown to customers and on invoices.">
        <Input id="org-name" className="sm:w-72" maxLength={200} value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })} />
      </SettingRow>
      <SettingRow label="Logo URL" htmlFor="org-logo" helper="Paste an image URL.">
        <Input id="org-logo" className="sm:w-72" type="url" value={value.logoUrl}
          onChange={(e) => setValue({ ...value, logoUrl: e.target.value })} />
      </SettingRow>
      <SettingRow label="Billing email" htmlFor="org-billing" helper="Where receipts and Stripe notices are sent.">
        <Input id="org-billing" className="sm:w-72" type="email" value={value.billingEmail}
          onChange={(e) => setValue({ ...value, billingEmail: e.target.value })} />
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Playwright verify (owner login).** Edit company name, Save → toast + persists on reload. Invalid email → server 400 surfaces as an error toast.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/settings/sections/OrganizationSection.tsx
git commit -m "feat(redesign-settings): Organization section"
```

---

## Task 7: Payments section (Stripe Connect embed)

**Files:**
- Modify: `src/components/redesign/settings/sections/PaymentsSection.tsx`

**Interfaces:**
- Consumes: `TenantStripeConnect` (default export), `getRedesignConnectAppearance`, `useTheme` (next-themes), `Skeleton`. No save bar.

- [ ] **Step 1: Implement PaymentsSection (mirror `PaymentsYourMoney` theming gate)**

```tsx
// src/components/redesign/settings/sections/PaymentsSection.tsx
"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import TenantStripeConnect from "@/components/TenantStripeConnect";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "../SettingRow";

export function PaymentsSection() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div>
      <SectionHeader title="Payments" lead="Your Stripe Connect account. You are the merchant of record for every charge." />
      {mounted ? (
        <TenantStripeConnect appearance={getRedesignConnectAppearance(resolvedTheme === "dark")} />
      ) : (
        <Skeleton className="h-40 w-full rounded-card" />
      )}
    </div>
  );
}
```

> The `mounted` gate is load-bearing: `resolvedTheme` is `undefined` on first client render and the Connect instance applies appearance only once at init (research: `PaymentsYourMoney.tsx`). While implementing, confirm `TenantStripeConnect` is a default export with optional `appearance` prop and that `getRedesignConnectAppearance(isDark)` lives at `@/lib/stripe/appearance` (both verified in research).

- [ ] **Step 2: Typecheck + Playwright verify (owner).** Open Payments section; the themed Connect embed renders (light theme = brand blue). No save bar.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/settings/sections/PaymentsSection.tsx
git commit -m "feat(redesign-settings): Payments section (themed Connect embed)"
```

---

## Task 8: Cancellation policy section

**Files:**
- Modify: `src/components/redesign/settings/sections/CancellationSection.tsx`

**Interfaces:**
- Loads the 8 policy columns from `organizations`; saves via `updateOrgPaymentSettings(orgId, {...})`. `platform_fee_bps` is read-only (never sent).

- [ ] **Step 1: Implement CancellationSection**

```tsx
// src/components/redesign/settings/sections/CancellationSection.tsx
"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateOrgPaymentSettings } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

type FeeType = "none" | "flat" | "percent";
interface PolicyForm {
  cancellationWindowHours: string; cancellationFeeType: FeeType; cancellationFeeValue: string;
  noShowFeeType: FeeType; noShowFeeValue: string;
}
const FEE_TYPES: { value: FeeType; label: string }[] = [
  { value: "none", label: "No fee" }, { value: "flat", label: "Flat amount" }, { value: "percent", label: "Percent of job" },
];

export function CancellationSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<PolicyForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("cancellation_window_hours, cancellation_fee_type, cancellation_fee_value, no_show_fee_type, no_show_fee_value")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      cancellationWindowHours: String(data?.cancellation_window_hours ?? 24),
      cancellationFeeType: (data?.cancellation_fee_type as FeeType) ?? "none",
      cancellationFeeValue: String(data?.cancellation_fee_value ?? 0),
      noShowFeeType: (data?.no_show_fee_type as FeeType) ?? "none",
      noShowFeeValue: String(data?.no_show_fee_value ?? 0),
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: PolicyForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgPaymentSettings(currentOrganizationId, {
      cancellation_window_hours: parseInt(v.cancellationWindowHours, 10) || 0,
      cancellation_fee_type: v.cancellationFeeType,
      cancellation_fee_value: parseFloat(v.cancellationFeeValue) || 0,
      no_show_fee_type: v.noShowFeeType,
      no_show_fee_value: parseFloat(v.noShowFeeValue) || 0,
    });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<PolicyForm>({ load, save, successMessage: "Cancellation policy updated" });

  if (loading || !value) return <SectionSkeleton />;

  return (
    <div>
      <SectionHeader title="Cancellation policy" lead="What happens when a booking is cancelled late or missed." />
      <SettingRow label="Free-cancel window" htmlFor="cx-window" helper="Cancellations before this many hours are free.">
        <Input id="cx-window" className="sm:w-32" type="number" min={0} max={720} value={value.cancellationWindowHours}
          onChange={(e) => setValue({ ...value, cancellationWindowHours: e.target.value })} />
      </SettingRow>
      <SettingRow label="Late cancellation fee">
        <div className="flex items-center gap-2">
          <Select value={value.cancellationFeeType} onValueChange={(t) => setValue({ ...value, cancellationFeeType: t as FeeType })}>
            <SelectTrigger className="w-40" aria-label="Cancellation fee type"><SelectValue /></SelectTrigger>
            <SelectContent>{FEE_TYPES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
          {value.cancellationFeeType !== "none" && (
            <Input className="w-28" type="number" min={0} step={value.cancellationFeeType === "percent" ? 1 : 0.01}
              max={value.cancellationFeeType === "percent" ? 100 : undefined} value={value.cancellationFeeValue}
              onChange={(e) => setValue({ ...value, cancellationFeeValue: e.target.value })} />
          )}
        </div>
      </SettingRow>
      <SettingRow label="No-show fee" helper="Charged when the customer is not home at the scheduled time.">
        <div className="flex items-center gap-2">
          <Select value={value.noShowFeeType} onValueChange={(t) => setValue({ ...value, noShowFeeType: t as FeeType })}>
            <SelectTrigger className="w-40" aria-label="No-show fee type"><SelectValue /></SelectTrigger>
            <SelectContent>{FEE_TYPES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
          {value.noShowFeeType !== "none" && (
            <Input className="w-28" type="number" min={0} step={value.noShowFeeType === "percent" ? 1 : 0.01}
              max={value.noShowFeeType === "percent" ? 100 : undefined} value={value.noShowFeeValue}
              onChange={(e) => setValue({ ...value, noShowFeeValue: e.target.value })} />
          )}
        </div>
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
```

> Scope note: legacy also edits late-reschedule fees and shows a read-only `platform_fee_bps`. This redesign keeps cancellation + no-show (the two most-used) for parity with the approved 6-section design; if reschedule fees are wanted, add two more rows with the `reschedule_*` columns + payload keys (same shape). Decide during review — the route already accepts them.

- [ ] **Step 2: Typecheck + Playwright verify (owner).** Change window + flat fee, Save → toast + persists. Switching fee type to "No fee" hides the value input.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/settings/sections/CancellationSection.tsx
git commit -m "feat(redesign-settings): Cancellation policy section"
```

---

## Task 9: Payout settings section (merged model + default %, owner)

**Files:**
- Modify: `src/components/redesign/settings/sections/PayoutSettingsSection.tsx`

**Interfaces:**
- Loads `default_payout_model, default_cleaner_payout_percent` from `organizations`; saves model via `updateOrgProfile` and percent via `updateOrgCleanerPayouts`.

- [ ] **Step 1: Implement PayoutSettingsSection**

```tsx
// src/components/redesign/settings/sections/PayoutSettingsSection.tsx
"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { updateOrgProfile, updateOrgCleanerPayouts } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

type PayoutModel = "percentage_contractor" | "hourly_external";
interface PayoutForm { model: PayoutModel; defaultPct: string }

export function PayoutSettingsSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<PayoutForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("default_payout_model, default_cleaner_payout_percent")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      model: (data?.default_payout_model as PayoutModel) ?? "percentage_contractor",
      defaultPct: String(data?.default_cleaner_payout_percent ?? 50),
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: PayoutForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgProfile(currentOrganizationId, { default_payout_model: v.model });
    const pct = parseFloat(v.defaultPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Default payout % must be between 0 and 100");
    await updateOrgCleanerPayouts(currentOrganizationId, { default_cleaner_payout_percent: pct });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<PayoutForm>({ load, save, successMessage: "Payout settings updated" });

  if (loading || !value) return <SectionSkeleton />;

  return (
    <div>
      <SectionHeader title="Payout settings" lead="How your cleaners get paid. Per-cleaner overrides live in the Cleaners screen." />
      <SettingRow label="Payout model" helper="Only percentage payouts are available today.">
        <RadioGroup value={value.model} onValueChange={(m) => setValue({ ...value, model: m as PayoutModel })} className="gap-3">
          <div className="flex items-center gap-2">
            <RadioGroupItem id="pm-pct" value="percentage_contractor" />
            <Label htmlFor="pm-pct" className="font-medium">Percentage of each job</Label>
          </div>
          <div className="flex items-center gap-2 opacity-50">
            <RadioGroupItem id="pm-hourly" value="hourly_external" disabled />
            <Label htmlFor="pm-hourly" className="font-medium">Hourly (coming soon)</Label>
          </div>
        </RadioGroup>
      </SettingRow>
      <SettingRow label="Default cleaner payout %" htmlFor="pm-default" helper="Applied to new cleaners unless overridden.">
        <Input id="pm-default" className="sm:w-28" type="number" min={0} max={100} value={value.defaultPct}
          onChange={(e) => setValue({ ...value, defaultPct: e.target.value })} />
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
```

> The merged save does two PATCHes (profile for the model, cleaner-payouts for the %). Both routes are owner-permitted and this section is owner-only, so a single Save commits both. If the model PATCH succeeds but the percent PATCH fails, the toast reports the error and the baseline is not reset (still dirty) — acceptable; note it in review.

- [ ] **Step 2: Typecheck + Playwright verify (owner).** Change default % and Save → toast + persists. Hourly radio is disabled.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/settings/sections/PayoutSettingsSection.tsx
git commit -m "feat(redesign-settings): merged Payout settings section"
```

---

## Task 10: Business hours section

**Files:**
- Modify: `src/components/redesign/settings/sections/BusinessHoursSection.tsx`

**Interfaces:**
- Loads `timezone, business_hours` from `organizations`; saves via `updateOrgBusinessHours(orgId, { timezone, business_hours })`.

- [ ] **Step 1: Implement BusinessHoursSection**

```tsx
// src/components/redesign/settings/sections/BusinessHoursSection.tsx
"use client";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateOrgBusinessHours } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
interface DayHours { open: string; close: string; closed: boolean }
type Hours = Record<DayKey, DayHours>;
interface HoursForm { timezone: string; hours: Hours }

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Monday" }, { key: "tue", label: "Tuesday" }, { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" }, { key: "fri", label: "Friday" }, { key: "sat", label: "Saturday" }, { key: "sun", label: "Sunday" },
];
const DEFAULT_HOURS: Hours = {
  mon: { open: "08:00", close: "17:00", closed: false }, tue: { open: "08:00", close: "17:00", closed: false },
  wed: { open: "08:00", close: "17:00", closed: false }, thu: { open: "08:00", close: "17:00", closed: false },
  fri: { open: "08:00", close: "17:00", closed: false }, sat: { open: "09:00", close: "14:00", closed: false },
  sun: { open: "09:00", close: "14:00", closed: true },
};
function listTimezones(): string[] {
  try {
    const tz = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (tz && tz.length) return tz;
  } catch { /* fall through */ }
  return ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
    "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris", "UTC"];
}

export function BusinessHoursSection() {
  const { currentOrganizationId } = useAuth();
  const timezones = useMemo(listTimezones, []);

  const load = useCallback(async (): Promise<HoursForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("timezone, business_hours")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      timezone: (data?.timezone as string | null) ?? "America/New_York",
      hours: { ...DEFAULT_HOURS, ...((data?.business_hours as Partial<Hours> | null) ?? {}) },
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: HoursForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgBusinessHours(currentOrganizationId, { timezone: v.timezone, business_hours: v.hours });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<HoursForm>({ load, save, successMessage: "Business hours updated" });

  if (loading || !value) return <SectionSkeleton />;

  const tzOptions = timezones.includes(value.timezone) ? timezones : [value.timezone, ...timezones];
  const setDay = (key: DayKey, patch: Partial<DayHours>) =>
    setValue({ ...value, hours: { ...value.hours, [key]: { ...value.hours[key], ...patch } } });

  return (
    <div>
      <SectionHeader title="Business hours" lead="Drives default availability and scheduling bounds." />
      <SettingRow label="Timezone" htmlFor="bh-tz">
        <Select value={value.timezone} onValueChange={(tz) => setValue({ ...value, timezone: tz })}>
          <SelectTrigger className="sm:w-72" aria-label="Timezone"><SelectValue /></SelectTrigger>
          <SelectContent>{tzOptions.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
        </Select>
      </SettingRow>
      {DAYS.map(({ key, label }) => {
        const row = value.hours[key];
        return (
          <SettingRow key={key} label={label}>
            <div className="flex items-center gap-3">
              {row.closed ? (
                <span className="text-sm text-muted-foreground">Closed</span>
              ) : (
                <>
                  <Input className="w-32" type="time" value={row.open} onChange={(e) => setDay(key, { open: e.target.value })} />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input className="w-32" type="time" value={row.close} onChange={(e) => setDay(key, { close: e.target.value })} />
                </>
              )}
              <Switch checked={!row.closed} onCheckedChange={(open) => setDay(key, { closed: !open })} aria-label={`${label} open`} />
            </div>
          </SettingRow>
        );
      })}
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + Playwright verify (owner).** Toggle a day closed, change a time, change timezone, Save → toast + persists on reload.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/settings/sections/BusinessHoursSection.tsx
git commit -m "feat(redesign-settings): Business hours section"
```

---

## Task 11: Full integration verification + polish (per role)

**Files:** none new (verification + any polish edits surfaced).

- [ ] **Step 1: Per-role Playwright pass (live dev Supabase).** Log in and open `/app/admin-dashboard/settings` as each: **owner** (sees all 6), **admin** (sees Profile, Payments, Cancellation, Business hours — NOT Organization/Payout), **manager with no payment/cleaner perms** (sees only Profile), **manager with `can_manage_payments`** (adds Payments + Cancellation), **manager with `can_manage_cleaners`** (adds Business hours). Confirm the index matches `deriveSettingsSections` for each. Screenshot each.

- [ ] **Step 2: Leave-guard verification.** In a section, make a change (save bar appears), click a different section in the index → the three-way dialog appears: "Keep editing" cancels; "Discard" switches and drops changes; "Save changes" saves (toast) then switches. Verify clicking the same active section does nothing.

- [ ] **Step 3: Entry-point + active-state verification.** From the operator dashboard, the rail **gear** opens settings and stays lit on every section; the top-bar profile menu "Settings" link opens it; while on legacy `/settings/*` (if reachable) the gear is also lit (via `activeFor`). Deep link `/app/admin-dashboard/settings?section=payout` lands on Payout settings (owner) and falls back to Profile for an admin.

- [ ] **Step 4: ui-ux-pro-max audit + native-feel polish.** Run the ui-ux-pro-max CLI for settings/form layout guidance (`C:\Users\mvbda\AppData\Local\Programs\Python\Python311\python.exe <search.py> -d ux "settings page form rows nav"`). Compare against the Customers/Services screens for visual consistency (radii, spacing, muted text, brand active state). Confirm: no card-in-card nesting, no "Back to dashboard", no owner pills, native rows with dividers, mobile index collapses cleanly. Fix anything off; commit polish with `git commit -m "fix(redesign-settings): native-feel polish from ui-ux-pro-max audit"`.

- [ ] **Step 5: Repo gates.** Run `npm run test` (all unit/integration green), `npx tsc --noEmit` (no new errors), `npm run lint`. Commit any fixes.

---

## Task 12: Codex pre-push review + PR

- [ ] **Step 1: Run the Codex branch review.** From the worktree, run the companion review against `master` (resolve the codex-companion path at runtime): `node "$(ls ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | tail -1)" review --scope branch --base master`.

- [ ] **Step 2: Apply valid findings** (ignore false positives) and commit as a separate follow-up: `git commit -m "fix: address Codex review"`.

- [ ] **Step 3: Push + open PR.** `git push -u origin feat/redesign-operator-settings`; open a PR to `master` titled `feat(redesign): operator Settings screen (flag-gated)`. Wait for CI / E2E green before merge (user-gated merge).

---

## Self-Review checklist (run by the plan author before handoff)

1. **Spec coverage:** nested quiet-left-index ✓ (Task 4 View); operator-only 6 sections ✓ (Tasks 1, 5-10); redesign-owned registry, legacy untouched ✓ (Task 1, Global Constraints); native rows / no card-in-card / no back button / no owner pills ✓ (Tasks 2, 4, 11); explicit save + dirty save bar + success toast ✓ (Task 2); three-way leave guard ✓ (Tasks 2, 4); default Profile ✓ (Task 1 `DEFAULT_SETTINGS_SECTION`); entry = rail gear + profile link ✓ (Task 3); gate-before-fetch ✓ (Task 4 container only mounts visible sections); Payments themed embed reuse ✓ (Task 7); per-section save routes reused ✓ (Tasks 5-10); dev preview + Playwright + Codex ✓ (Tasks 4, 11, 12).
2. **Placeholders:** none — every step has concrete code or an exact command. Section stubs (Task 4) are intentional scaffolding replaced in Tasks 5-10.
3. **Type consistency:** `SettingsSectionId` union is identical in `sections.ts`, `registry.ts`, container, and View; `SettingsGuard`/`useRegisterSettingsGuard` signatures match between `SettingsNavGuard.tsx`, `useSettingsSection.ts`, and the container; `useSettingsSection` return shape (`value/setValue/loading/saving/isDirty/onSave/onDiscard`) is consumed consistently by every section.
