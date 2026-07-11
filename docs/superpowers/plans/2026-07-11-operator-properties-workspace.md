# Operator Properties Workspace (R4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a full Properties workspace in the redesigned console (list, create/edit/delete, photo, instructions, homeowner assignment, book-from-property) so self-pay orgs and phone-bookings-for-new-addresses stop dead-ending.

**Architecture:** Client-direct Supabase writes gated by existing RLS (no new routes). A top-level `Properties` nav tab renders a dense table (`OperatorProperties`); a shell-level `?property=` host (`OperatorPropertyDetailHost`, modeled on the `?booking=` host) opens a right-side `PropertyDetailSheet` (read → edit/create) from anywhere. Delete is a bucketed model that preserves history by archiving (soft-delete) rather than cascading. Two booking wires (seed-from-property, inline add-property) make it operational.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, Supabase (Postgres + RLS + Realtime + Storage), TanStack Query v5, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-07-11-operator-properties-workspace-design.md` (read it first — this plan implements it).

## Global Constraints

Every task's requirements implicitly include these:

- **Branch:** `feat/operator-properties-workspace` (already created; spec committed as `08726cf`). Never commit to `master`.
- **Ship from the design system.** Implement every screen from `src/components/ui/*` + tokens (`tailwind.config.js`, `src/app/globals.css`): brand `#0150FC`, Plus Jakarta Sans, warm canvas, `rounded-card`/`rounded-control`, `shadow-soft-*`, semantic tokens (`bg-critical-50`, `text-critical-700`, `text-muted-foreground`, etc.). The browser-companion mockups under `.superpowers/brainstorm/` are UX/structure reference ONLY — never copy their inline hex/beige/blue styling. Status uses the badge/pill vocabulary, not decorative accent bars.
- **No em dashes** in any user-facing copy (labels, buttons, toasts, empty states, dialog text). Use periods, commas, parentheses, or "to".
- **Writes are client-direct + RLS.** Do NOT add a service-role property-write route or import `supabase-admin` in client code. RLS (migration 104) is the boundary.
- **No new deps.** Reuse existing primitives and hooks.
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Gates before "done" on any task:** `npx tsc --noEmit` shows no NEW errors (12 pre-existing baseline is OK), `npm run lint` is clean on changed files, and `npm run test` stays green. Pure-logic tasks add Vitest unit tests; UI/query tasks verify via tsc/lint + a described browser check.
- **Column facts (verbatim):** `properties(id, owner_id NULLABLE [NULL=org-owned], name, address, city, state, zip_code, bedrooms int, bathrooms int, square_feet int, special_instructions, access_instructions, photo_url, organization_id, created_at, updated_at)` + new `archived_at timestamptz`. `AppointmentStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'`. `recurring_appointment_series` has `property_id` + `is_active boolean`.

---

### Task 1: Migration — `archived_at` flag + realtime publication

**Files:**
- Create: `supabase/migrations/107_properties_archive_and_realtime.sql`

**Interfaces:**
- Produces: a nullable `properties.archived_at timestamptz` column (NULL = active); `properties` added to the `supabase_realtime` publication.

- [ ] **Step 1: Write the migration.** Copy the publication guard shape from `supabase/migrations/081_realtime_enable.sql:31-58`.

```sql
-- 107: Properties workspace (R4) — soft-delete/archive flag + realtime publication.

-- 1. Archive flag. NULL = active; non-null timestamp = archived (hidden everywhere).
--    A property with any appointment history is archived instead of hard-deleted so
--    completed/cancelled records still resolve their property.
ALTER TABLE "public"."properties" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_properties_archived_at" ON "public"."properties" ("archived_at");

-- 2. Add properties to the realtime publication (guarded so re-running is safe).
--    properties already has REPLICA IDENTITY FULL (000_baseline) but was never added
--    to the publication, so the existing properties:${orgId} subscription never fired.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'properties'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.properties';
  END IF;
END $$;
```

- [ ] **Step 2: Rebuild the schema locally.**

Run: `npx supabase db reset`
Expected: completes with no error; all migrations apply.

- [ ] **Step 3: Verify the column and publication.**

Run: `npx supabase db reset && psql "$(npx supabase status --output json | python3 -c "import sys,json;print(json.load(sys.stdin)['DB_URL'])")" -c "\d public.properties" -c "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='properties';"`
Expected: `archived_at | timestamp with time zone` present; one row `properties` in the publication query.
(If `psql` is unavailable, open Studio at :54323 and confirm the column + `supabase db reset` succeeding is sufficient.)

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/107_properties_archive_and_realtime.sql
git commit -m "feat(db): properties archived_at flag + realtime publication (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Promote shared property logic out of the homeowner namespace

**Files:**
- Move: `src/components/redesign/homeowner/account/properties/validateProperty.ts` → `src/lib/properties/validateProperty.ts`
- Move: `src/components/redesign/homeowner/account/properties/validateProperty.test.ts` → `src/lib/properties/validateProperty.test.ts`
- Move: `src/components/redesign/homeowner/account/properties/PropertyPhotoField.tsx` → `src/components/redesign/properties/PropertyPhotoField.tsx`
- Modify: every importer of the three moved files (find via grep).

**Interfaces:**
- Produces: `@/lib/properties/validateProperty` exporting `PropertyFormValues`, `EMPTY_PROPERTY_FORM`, `validateProperty`, `toNumberOrNull`; `@/components/redesign/properties/PropertyPhotoField` exporting `PropertyPhotoField`.

- [ ] **Step 1: Find all importers.**

Run: `grep -rln "account/properties/validateProperty\|account/properties/PropertyPhotoField\|from './validateProperty'\|from './PropertyPhotoField'" src/`
Expected: at least `PropertyFormSheet.tsx` (imports both) and the two test/`derive` files; note every hit.

- [ ] **Step 2: Move the files with `git mv`** (preserves history), then re-point imports.

```bash
mkdir -p src/lib/properties src/components/redesign/properties
git mv src/components/redesign/homeowner/account/properties/validateProperty.ts src/lib/properties/validateProperty.ts
git mv src/components/redesign/homeowner/account/properties/validateProperty.test.ts src/lib/properties/validateProperty.test.ts
git mv src/components/redesign/homeowner/account/properties/PropertyPhotoField.tsx src/components/redesign/properties/PropertyPhotoField.tsx
```

Update each importer found in Step 1 to the new paths: `@/lib/properties/validateProperty` and `@/components/redesign/properties/PropertyPhotoField`. In `PropertyFormSheet.tsx` change `import { PropertyPhotoField } from './PropertyPhotoField'` and `from './validateProperty'` accordingly.

- [ ] **Step 3: Run the moved unit test + typecheck.**

Run: `npm run test:unit -- validateProperty && npx tsc --noEmit`
Expected: validateProperty tests pass; no NEW tsc errors.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "refactor(properties): promote validateProperty + PropertyPhotoField to shared modules (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `Property` type extension + archived read filter across all property reads

**Files:**
- Modify: `src/types/index.ts` (Property type; add `photo_url: string | null`, `archived_at: string | null`)
- Modify: `src/hooks/useAdminData.ts` (`useAdminProperties` select + the `AdminProperty` type; add `.is('archived_at', null)`)
- Modify: `src/hooks/useAdminData.ts` `useCustomerDetails` property select (add archived filter)
- Modify: `src/components/redesign/bookings/new-booking/usePropertiesByOwner.ts` (add archived filter)
- Modify: homeowner property reads — the query behind `keys.properties.byHomeowner` (find in `useHomeownerData.ts` / homeowner properties hook) — add archived filter.

**Interfaces:**
- Produces: no archived property is ever returned by any list/detail/picker query (operator or homeowner).

- [ ] **Step 1: Extend the type.** In `src/types/index.ts` Property interface (near line 146), add `photo_url: string | null;` and `archived_at: string | null;`. If `AdminProperty` in `useAdminData.ts` is a distinct interface, add the same two fields there.

- [ ] **Step 2: Add `.is('archived_at', null)` to every property read.** For each Supabase query listed in Files, add `.is('archived_at', null)` in the query chain (alongside the existing `.eq('organization_id', ...)` / owner filter). Grep to be exhaustive:

Run: `grep -rn "from('properties')" src/ | grep -i "select\|from('properties')"`
Expected: audit each read site; every SELECT that lists properties for display gets the archived filter. (Write helpers like `updateProperty`/`archiveOrDeleteProperty` do NOT filter — they operate by id.)

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no NEW errors.

- [ ] **Step 4: Browser check.** With `npm run dev` + local Supabase, manually set one property's `archived_at` via Studio and confirm it disappears from the admin Customers property list and the booking picker (full workspace verification happens in later tasks; this confirms the filter).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(properties): Property type gains photo_url/archived_at; exclude archived rows from all reads (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Delete-plan pure logic + `archiveOrDeleteProperty` executor (TDD)

**Files:**
- Create: `src/lib/properties/deletePlan.ts`
- Create: `src/lib/properties/deletePlan.test.ts`
- Modify: `src/hooks/useAdminData.ts` (add `archiveOrDeleteProperty`)

**Interfaces:**
- Produces:
  - `type PropertyDeletePlan = { action: 'hard-delete' | 'cancel-and-archive' | 'archive-only'; liveCount: number; historyCount: number; needsBookingEdit: boolean }`
  - `planPropertyDeletion(counts: { liveCount: number; historyCount: number }): PropertyDeletePlan`
  - `async function archiveOrDeleteProperty(propertyId: string, organizationId: string): Promise<{ success: boolean; action?: PropertyDeletePlan['action']; error?: string }>`
- Consumes: `AppointmentStatus` live set = `('pending','confirmed','in_progress')`; history set = `('completed','cancelled')`.

- [ ] **Step 1: Write failing tests for the pure planner.**

```ts
// src/lib/properties/deletePlan.test.ts
import { describe, it, expect } from 'vitest';
import { planPropertyDeletion } from './deletePlan';

describe('planPropertyDeletion', () => {
  it('hard-deletes a never-booked property', () => {
    expect(planPropertyDeletion({ liveCount: 0, historyCount: 0 })).toEqual({
      action: 'hard-delete', liveCount: 0, historyCount: 0, needsBookingEdit: false,
    });
  });
  it('archives (no cancel) when only history exists', () => {
    expect(planPropertyDeletion({ liveCount: 0, historyCount: 3 })).toEqual({
      action: 'archive-only', liveCount: 0, historyCount: 3, needsBookingEdit: false,
    });
  });
  it('cancels live cleanings then archives when live exist; needs booking-edit', () => {
    expect(planPropertyDeletion({ liveCount: 2, historyCount: 5 })).toEqual({
      action: 'cancel-and-archive', liveCount: 2, historyCount: 5, needsBookingEdit: true,
    });
  });
  it('cancel-and-archive even with zero history when live exist', () => {
    expect(planPropertyDeletion({ liveCount: 1, historyCount: 0 })).toEqual({
      action: 'cancel-and-archive', liveCount: 1, historyCount: 0, needsBookingEdit: true,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test:unit -- deletePlan`
Expected: FAIL ("planPropertyDeletion is not a function").

- [ ] **Step 3: Implement the planner.**

```ts
// src/lib/properties/deletePlan.ts
export type PropertyDeleteAction = 'hard-delete' | 'cancel-and-archive' | 'archive-only';

export interface PropertyDeletePlan {
  action: PropertyDeleteAction;
  liveCount: number;
  historyCount: number;
  needsBookingEdit: boolean;
}

/** Live (blocking) appointment statuses that get cancelled on property delete. */
export const LIVE_APPT_STATUSES = ['pending', 'confirmed', 'in_progress'] as const;
/** Terminal statuses preserved as history. */
export const HISTORY_APPT_STATUSES = ['completed', 'cancelled'] as const;

export function planPropertyDeletion(counts: { liveCount: number; historyCount: number }): PropertyDeletePlan {
  const { liveCount, historyCount } = counts;
  if (liveCount === 0 && historyCount === 0) {
    return { action: 'hard-delete', liveCount, historyCount, needsBookingEdit: false };
  }
  if (liveCount === 0) {
    return { action: 'archive-only', liveCount, historyCount, needsBookingEdit: false };
  }
  return { action: 'cancel-and-archive', liveCount, historyCount, needsBookingEdit: true };
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `npm run test:unit -- deletePlan`
Expected: PASS.

- [ ] **Step 5: Implement the executor in `useAdminData.ts`.** Add below `deleteProperty`. It counts, plans, and executes. All via the anon client so RLS applies (property UPDATE/DELETE → `can_edit_properties`; appointment UPDATE → `can_edit_bookings`).

```ts
import { planPropertyDeletion, LIVE_APPT_STATUSES } from '@/lib/properties/deletePlan';

/**
 * Delete a property safely (R4). Never-booked → hard delete. Any history →
 * cancel live cleanings + stop active recurring series, then archive (soft-delete)
 * so completed/cancelled records still resolve. Returns the action taken.
 */
export async function archiveOrDeleteProperty(propertyId: string, organizationId: string) {
  try {
    // Org-scope guard (RLS enforces the real permission).
    const { data: property, error: checkError } = await supabase
      .from('properties').select('organization_id').eq('id', propertyId).single();
    if (checkError) throw checkError;
    if (!property || property.organization_id !== organizationId) {
      return { success: false, error: 'Property not found or does not belong to this organization' };
    }

    const [{ count: liveCount, error: liveErr }, { count: historyCount, error: histErr }] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true })
        .eq('property_id', propertyId).in('status', LIVE_APPT_STATUSES as unknown as string[]),
      supabase.from('appointments').select('id', { count: 'exact', head: true })
        .eq('property_id', propertyId).in('status', ['completed', 'cancelled']),
    ]);
    if (liveErr) throw liveErr;
    if (histErr) throw histErr;

    const plan = planPropertyDeletion({ liveCount: liveCount ?? 0, historyCount: historyCount ?? 0 });

    if (plan.action === 'hard-delete') {
      const { error } = await supabase.from('properties').delete().eq('id', propertyId);
      if (error) throw error;
      return { success: true, action: plan.action };
    }

    if (plan.action === 'cancel-and-archive') {
      const { error: cancelErr } = await supabase.from('appointments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('property_id', propertyId).in('status', LIVE_APPT_STATUSES as unknown as string[]);
      if (cancelErr) throw cancelErr;
      // Stop any active recurring series so no new appointments generate for an archived property.
      const { error: seriesErr } = await supabase.from('recurring_appointment_series')
        .update({ is_active: false }).eq('property_id', propertyId).eq('is_active', true);
      if (seriesErr) throw seriesErr;
    }

    // archive-only and cancel-and-archive both end by soft-deleting the property.
    const { error: archiveErr } = await supabase.from('properties')
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', propertyId);
    if (archiveErr) throw archiveErr;
    return { success: true, action: plan.action };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete property' };
  }
}
```

Also export a lightweight counter for the dialog to render copy before the user confirms:

```ts
export async function countPropertyAppointments(propertyId: string) {
  const [{ count: live }, { count: history }] = await Promise.all([
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).in('status', LIVE_APPT_STATUSES as unknown as string[]),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).in('status', ['completed', 'cancelled']),
  ]);
  return { liveCount: live ?? 0, historyCount: history ?? 0 };
}
```

- [ ] **Step 6: Typecheck + unit.**

Run: `npx tsc --noEmit && npm run test:unit -- deletePlan`
Expected: no NEW errors; tests pass.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(properties): safe delete planner + archiveOrDeleteProperty executor (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Properties nav item + route + page guard

**Files:**
- Modify: `src/components/redesign/shell/nav-items.ts` (add the item + `Building2` import)
- Modify: `src/components/redesign/shell/nav-items.test.ts` (snapshot/expectations)
- Create: `src/app/(redesign)/app/admin-dashboard/properties/page.tsx`

**Interfaces:**
- Consumes: `useRequireManagerFlag` (`src/lib/redesign/useRequireManagerFlag.ts`), `OperatorProperties` (Task 6 — for now render a placeholder that Task 6 replaces).
- Produces: nav item `id:'properties'` gated on `can_view_properties`; route `/app/admin-dashboard/properties`.

- [ ] **Step 1: Add the nav item.** In `nav-items.ts`, import `Building2` from `lucide-react` and add after the Calendar item (`:39`):

```ts
{ id: "properties", label: "Properties", href: "/app/admin-dashboard/properties", icon: Building2, requires: "can_view_properties" },
```

- [ ] **Step 2: Update the nav test.** Adjust `nav-items.test.ts` for the new item (expected count / snapshot). Run `npm run test:unit -- nav-items` and update expectations to match.

- [ ] **Step 3: Create the page.** Copy `src/app/(redesign)/app/admin-dashboard/calendar/page.tsx` structure exactly, swapping the guard flag, active id, and child:

```tsx
'use client';
import { useRequireManagerFlag } from '@/lib/redesign/useRequireManagerFlag';
import { OperatorShell } from '@/components/redesign/shell/OperatorShell';
import { OperatorProperties } from '@/components/redesign/properties/OperatorProperties';

export default function PropertiesPage() {
  const allowed = useRequireManagerFlag('can_view_properties');
  if (!allowed) return null;
  return (
    <OperatorShell active="properties">
      <OperatorProperties />
    </OperatorShell>
  );
}
```

(Match the ACTUAL shape of `calendar/page.tsx` — if it wraps differently, mirror that. Until Task 6 lands, stub `OperatorProperties` as `export function OperatorProperties(){ return null }` so this compiles.)

- [ ] **Step 4: Typecheck + nav test + lint.**

Run: `npx tsc --noEmit && npm run test:unit -- nav-items && npm run lint`
Expected: clean.

- [ ] **Step 5: Browser check.** As an owner, the `Properties` tab appears in the rail/More; as a manager without `can_view_properties`, it's hidden and hard-loading `/app/admin-dashboard/properties` redirects. (Seed users exist: `owner-verify@test.local` / `manager-verify@test.local`, `TestPass123!`.)

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(operator): Properties nav destination + guarded route (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `OperatorProperties` list (table + filter + row menu)

**Files:**
- Create: `src/components/redesign/properties/OperatorProperties.tsx`
- Create: `src/components/redesign/properties/propertyRowVM.ts` (+ `.test.ts`)

**Interfaces:**
- Consumes: `useAdminProperties()` (returns `{ properties: AdminProperty[], loading, error, refetch }`), `ListFilterBar`, `Skeleton`, `EmptyState`, `ErrorState`, `Badge`, the shell `?property=` opener from Task 7 (`useOpenProperty().open(id)` — until Task 7 lands, set `?property=` via `router`/URLSearchParams directly and Task 7 swaps in the hook).
- Produces: the list surface; row click / "Book" / "Edit" / "Delete" actions.

- [ ] **Step 1: Write the row view-model (pure) + failing test.** Encapsulate the display mapping so it's testable (owner label vs Org-owned, details string).

```ts
// propertyRowVM.ts
import type { AdminProperty } from '@/hooks/useAdminData';
export interface PropertyRowVM { id: string; name: string; addressLine: string; ownerLabel: string; isOrgOwned: boolean; detailsLabel: string; photoUrl: string | null; }
export function toPropertyRowVM(p: AdminProperty): PropertyRowVM {
  const isOrgOwned = !p.owner_id;
  const ownerLabel = isOrgOwned ? 'Org-owned'
    : [p.homeowner?.first_name, p.homeowner?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const details = [p.bedrooms != null ? `${p.bedrooms} bd` : null, p.bathrooms != null ? `${p.bathrooms} ba` : null, p.square_feet != null ? `${p.square_feet.toLocaleString()} sf` : null].filter(Boolean).join(' · ');
  return { id: p.id, name: p.name, addressLine: [p.address, p.city, p.state].filter(Boolean).join(', '), ownerLabel, isOrgOwned, detailsLabel: details || 'No details', photoUrl: p.photo_url ?? null };
}
```

Test both branches (homeowner-owned and `owner_id: null`) and the null-details fallback. Run `npm run test:unit -- propertyRowVM`, verify fail then pass.

- [ ] **Step 2: Build the list component.** Mirror `src/components/redesign/customers/OperatorCustomers.tsx` structure (list ↔ sheet, `ListFilterBar`, states). Table columns per spec §7.1: thumbnail+name / address / homeowner-or-Org-owned badge / details / row `DropdownMenu` (Book, Edit, Delete). Search filters name+address; segmented filter All/Homeowner/Org-owned. Thumbnail uses `photo_url` with a `Building2`/placeholder fallback. Below the mobile breakpoint, render stacked cards instead of the table (do not horizontally scroll a 5-column table). Use `Skeleton` while `loading`, `ErrorState` (with `refetch`) on `error`, `EmptyState` ("No properties yet." + an "Add property" button) when empty. Gate the "Add property"/Edit/Delete affordances on `useManagerPermissions().permissions.can_edit_properties`.

- [ ] **Step 3: Wire actions.** Row click and the "Edit" menu set `?property=<id>` (Task 7 host renders it; Task 8 handles edit mode). "Delete" opens the delete dialog (Task 10). "Book" triggers the Task 11 seeding. "Add property" opens the create sheet (Task 8). Until those land, wire the URL param and leave TODO-free stubs that call the (about-to-exist) openers.

- [ ] **Step 4: Typecheck + lint + browser.**

Run: `npx tsc --noEmit && npm run lint`
Then browser-verify the list renders with seeded data, filters work, empty/loading/error states render.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): Properties list with filter, states and row menu (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `OperatorPropertyDetailHost` (`?property=`) + read-mode sheet shell

**Files:**
- Create: `src/components/redesign/properties/OperatorPropertyDetailHost.tsx`
- Create: `src/components/redesign/properties/useOpenProperty.ts` (operator opener; model on `useOpenBookingDetail` / `useOpenOperatorBooking`)
- Create: `src/components/redesign/properties/PropertyDetailSheet.tsx` (read mode this task; edit/create added in Task 9)
- Modify: `src/components/redesign/shell/OperatorShell.tsx` (mount the host, gated `can_view_properties`, exactly like the `?booking=` host)

**Interfaces:**
- Consumes: `useAdminProperties()` (to resolve the `?property=` id to an `AdminProperty`; or a `useProperty(id)` selector over the same cache), `Sheet`/`SheetContent side="right"`, shared `Field` from `@/components/redesign/bookings/detail-atoms`.
- Produces: `useOpenProperty()` → `{ open(id): void; close(): void }` (merges `window.location.search` at call time like `useOpenBookingDetail`, so it preserves other params); the host that renders `PropertyDetailSheet` when `?property=` is present.

- [ ] **Step 1: Study the booking host.** Read `OperatorBookingDetailHost.tsx` + `useOpenBookingDetail`/`useOpenOperatorBooking` to copy the param-owner pattern (single owner of the param; opener merges existing search params; host reads the param and renders the sheet; close removes the param).

- [ ] **Step 2: Implement `useOpenProperty`** as the `?property=` analog (open sets `?property=<id>` preserving other params; close deletes it).

- [ ] **Step 3: Implement the read-mode sheet.** `Sheet` + `SheetContent side="right" className="... sm:max-w-md"`. Sections per spec §7.2: hero photo (or placeholder) → name + address → Homeowner (avatar+name+email, or `Org-owned` badge) → Details (bd/ba/sqft) → Special instructions → Access instructions (each read row via the shared `Field`). Footer: `Book cleaning` (primary), `Edit` (secondary), `Delete` (quiet, `text-critical-*`, separated). Wire `Edit`/`Delete`/`Book` to callbacks the host passes (host owns edit/delete state; Task 8 = edit, Task 10 = delete, Task 11 = book implement these).

- [ ] **Step 4: Mount the host in `OperatorShell`.** Add `{canViewProperties && <OperatorPropertyDetailHost/>}` next to the booking host, gated the same way (`useManagerPermissions`).

- [ ] **Step 5: Typecheck + lint + browser.** Clicking a Properties row (Task 6) opens the read sheet in place; opening `?property=` from the URL works on other operator pages too.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(operator): shell-level ?property= host + read-mode detail sheet (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `PropertyDetailSheet` edit + create modes

**Files:**
- Modify: `src/components/redesign/properties/PropertyDetailSheet.tsx` (add edit/create)
- Reference (lift logic, do NOT re-fork): `src/components/redesign/homeowner/account/properties/PropertyFormSheet.tsx`

**Interfaces:**
- Consumes: `validateProperty`, `EMPTY_PROPERTY_FORM`, `toNumberOrNull`, `PropertyFormValues` from `@/lib/properties/validateProperty`; `updateProperty` from `@/hooks/useAdminData`; `PropertyPhotoField` from `@/components/redesign/properties/PropertyPhotoField`; `FormField`, `Input`, `Textarea`, `DiscardChangesDialog` (`bookings/detail-atoms`).
- Produces: `onSave(): Promise<boolean>` following the `CustomerDetailSheet` `canEdit/editing/onEditingChange/onSave` contract; a create entry point `PropertyDetailSheet` can open with no property.

- [ ] **Step 1: Add edit mode.** Toggle read↔edit like `CustomerDetailSheet`. Fields (lift the `fromProperty` mapping + payload build from `PropertyFormSheet.tsx:29-42,107-118`): name*, address*, city*, state*, zip_code* (required via `validateProperty`), bedrooms/bathrooms/square_feet (`inputMode="numeric"`, parsed with `toNumberOrNull`), special_instructions, access_instructions (`Textarea`). Label special instructions "Special instructions" (operator wording), not "Special requests".
- [ ] **Step 2: Save = disabled-until-dirty.** Track a dirty flag (compare form to the loaded property); disable Save when not dirty. On save call `updateProperty(id, { ...payload, photo_url })`; on success `toast.success('Property updated')`, invalidate `keys.properties.byOrg(orgId)` (+ `keys.customers.byOrg`), return `true`. On failure surface the error, return `false`. Dirty-close → `DiscardChangesDialog`.
- [ ] **Step 3: Add create mode.** Empty form; insert via `supabase.from('properties').insert({ ...payload, owner_id: <selectedOwnerOrNull>, organization_id })` (lift from `PropertyFormSheet.tsx:125-131` but set `owner_id` from the create context, not `user.id`). **Photo control only after first save** — render `PropertyPhotoField` only when a property id exists (edit), and in create show the "Save this property first to add a photo." affordance. On create success, invalidate the org properties key and open the new property in edit mode (so the photo field appears).
- [ ] **Step 4: Typecheck + lint + browser.** Create a property (name/address/details), save, reopen, add a photo, edit instructions, discard-guard fires on dirty close.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): property create/edit in the detail sheet, save-when-dirty + photo-after-save (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Homeowner assign / change / remove block

**Files:**
- Modify: `src/components/redesign/properties/PropertyDetailSheet.tsx` (assignment block in edit mode)
- Create (if no reusable picker exists): `src/components/redesign/properties/HomeownerAssignField.tsx`

**Interfaces:**
- Consumes: a query of org members with `organization_members.role='homeowner'` (reuse the customers hook if one exposes the list, else a small query keyed `keys.customers.byOrg`); `stripeSelfPayUiEnabled()` (find the existing flag helper); `updateProperty` for the `owner_id` write.
- Produces: setting/clearing `owner_id` on the property.

- [ ] **Step 1: Gate the block.** Render the assignment controls only when `stripeSelfPayUiEnabled()` AND `can_edit_properties` (mirror legacy `PropertySidePanel` gating).
- [ ] **Step 2: Assigned state.** Show homeowner avatar/name/email with `Change` and `Remove`. `Remove` sets `owner_id = null` (property becomes Org-owned) via `updateProperty(id, { owner_id: null })` — note `updateProperty`'s current signature omits `owner_id`; extend it to accept `owner_id?: string | null`.
- [ ] **Step 3: Unassigned state.** Show `Org-owned` + an `Assign homeowner` picker searching org homeowners; selecting one writes `owner_id`.
- [ ] **Step 4: Typecheck + lint + browser.** Assign, change, and remove a homeowner; verify the list badge flips to `Org-owned` after remove (realtime invalidation refreshes it).
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): assign/change/remove homeowner on a property (org-owned on remove) (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: `PropertyDeleteDialog` — warning card, override, permission gate

**Files:**
- Create: `src/components/redesign/properties/PropertyDeleteDialog.tsx`
- Modify: `src/components/redesign/properties/PropertyDetailSheet.tsx` / host (open the dialog from `Delete`)

**Interfaces:**
- Consumes: `countPropertyAppointments`, `archiveOrDeleteProperty`, `planPropertyDeletion` (Task 4); `useManagerPermissions().permissions.can_edit_bookings`; `Dialog`/`ConfirmDialog`, `toast`.
- Produces: the delete flow per spec §7.4.

- [ ] **Step 1: On open, fetch counts.** Call `countPropertyAppointments(propertyId)`; derive `plan = planPropertyDeletion(counts)`.
- [ ] **Step 2: Render by action.**
  - `hard-delete`: standard confirm ("Delete <name>? No cleanings on record. This is permanent and can't be undone."). Confirm → `archiveOrDeleteProperty`.
  - `archive-only`: "Delete <name>? Past cleanings stay on record. The property is archived so history still resolves." Confirm → `archiveOrDeleteProperty`.
  - `cancel-and-archive`: the big warning card — "This property has N upcoming cleanings that will be cancelled. Past and cancelled cleanings stay on record. The property is archived." **If `!can_edit_bookings`**, disable the confirm and show "Removing the upcoming cleanings needs booking-edit permission. Ask an admin, or cancel those cleanings first." Confirm → `archiveOrDeleteProperty`.
- [ ] **Step 3: On success.** `toast.success` (message per action), close the sheet, invalidate `keys.properties.byOrg` (+ `keys.customers.byOrg`, `keys.appointments.all` when live cleanings were cancelled). On failure `toast.error` with the message. No em dashes in any copy.
- [ ] **Step 4: Typecheck + lint + browser.** Seed a property with an upcoming appointment → warning card, override cancels it + archives; a never-booked property → hard delete; a manager lacking `can_edit_bookings` sees the disabled override.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): property delete dialog (warn+override, cancel-upcoming+archive, permission-gated) (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Book-from-property seeding

**Files:**
- Modify: the operator new-booking param contract (`operatorBookingParams` + `useOpenOperatorBooking.ts`), `OperatorBookingHost.tsx`, `OperatorBookingForm.tsx` (initializer ~`:61-76`, billTo reset ~`:194-214`)
- Create: `src/components/redesign/bookings/new-booking/seedFromProperty.ts` (+ `.test.ts`) — pure builder

**Interfaces:**
- Consumes: an `AdminProperty` (or `{ id, owner_id }`) to build seed params.
- Produces: `buildPropertySeed(p): { customerId?: string; propertyId: string; billTo: 'customer' | 'company' }` and extended `?newbooking=` params carrying `customerId`/`propertyId`/`billTo`.

- [ ] **Step 1: TDD the seed builder.** Homeowner-owned property → `{ customerId: owner_id, propertyId, billTo: 'customer' }`; org-owned (null owner) → `{ propertyId, billTo: 'company' }` (no customerId). Write `seedFromProperty.test.ts`, verify fail, implement `buildPropertySeed`, verify pass. (Confirm the real billTo values used by `OperatorBookingForm` and match them exactly.)
- [ ] **Step 2: Extend the param contract.** Add `customerId`, `propertyId`, `billTo` to `operatorBookingParams` + the opener; read them in `OperatorBookingHost`; in the form initializer, seed `state` from these params. **Set `billTo` before `customerId`/`propertyId`** (or guard the reset effect) so the billTo-flip reset (`:194-214`) doesn't clobber the seeded customer/property.
- [ ] **Step 3: Wire the sheet's "Book cleaning".** `PropertyDetailSheet` footer + the list row "Book" call `useOpenOperatorBooking().open(buildPropertySeed(property))`.
- [ ] **Step 4: Typecheck + lint + unit + browser.** Book from a homeowner property → customer+property pre-filled; from an org-owned property → company bill-to, property pre-filled.
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): book-from-property seeds the new-booking sheet (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Inline add-property for zero-property customers

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx` (property picker empty state ~`:228-237`), `usePropertiesByOwner.ts`

**Interfaces:**
- Consumes: the create-mode `PropertyDetailSheet` (Task 8), `usePropertiesByOwner`.
- Produces: inline create + auto-select in the picker.

- [ ] **Step 1: Add the empty-state action.** When the picker has no properties for the selected customer, render "+ Add a property" that opens the create sheet pre-seeded with the current `customerId` as `owner_id`.
- [ ] **Step 2: On create success, refresh + select.** Invalidate `usePropertiesByOwner`'s key (`['operator-booking','properties-by-owner',orgId,ownerId]`) and auto-select the new property id in the form.
- [ ] **Step 3: Typecheck + lint + browser.** For a customer with zero properties, add one inline and confirm it auto-selects and the booking proceeds.
- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "feat(operator): inline add-property in the zero-property booking picker (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: `CustomerDetailSheet` property deep-link

**Files:**
- Modify: `src/components/redesign/customers/CustomerDetailSheet.tsx` (property cards ~`:208-221`) + its presenter props / VM in `OperatorCustomers.tsx`

**Interfaces:**
- Consumes: `useOpenProperty()` (Task 7).
- Produces: clicking a customer's property card opens the property sheet in place (`?property=<id>`), preserving the customer context.

- [ ] **Step 1: Add the affordance.** Make each read-only property card actionable (button/row) that calls `useOpenProperty().open(p.id)`. Thread an `onOpenProperty` handler through the presenter props (the sheet is a dumb presenter; the container wires the opener). Keep the cards read-only otherwise.
- [ ] **Step 2: Typecheck + lint + browser.** From a customer with properties, click a property card → property sheet opens over the Customers page; closing returns to the customer sheet with `?c=`/context intact.
- [ ] **Step 3: Commit.**

```bash
git add -A
git commit -m "feat(operator): customer property cards deep-link into the Properties workspace (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Full verification pass + ui-ux-pro-max conformance + optional E2E

**Files:**
- Create (optional): `tests/e2e/operator-properties.spec.ts`

- [ ] **Step 1: Gates.** `npm run test` (all green), `npx tsc --noEmit` (only the 12 pre-existing baseline errors), `npm run lint` (clean on changed files), `npx supabase db reset` (schema rebuilds, integration tests still pass).
- [ ] **Step 2: ui-ux-pro-max implementation-phase conformance.** Run the skill against the built Properties components; fix any flagged off-system styling (raw hex, non-token colors, touch-target sizes, missing focus/disabled states). Confirm no mockup styling leaked (grep the new files for stray hex).
- [ ] **Step 3: Browser walkthrough (send screenshots to Bridger).** List (table + filters + empty/loading/error, mobile cards), read/edit/create sheet, photo-after-save, homeowner assign/change/remove, delete (all three actions + permission-gated override), book-from-property, inline add-property, customer deep-link. Verify no console errors, no legacy `/admin-dashboard?tab=` escapes.
- [ ] **Step 4 (optional): E2E happy path.** A Playwright spec covering open → create → edit → book-from-property, scoped against existing E2E patterns in `tests/e2e/`.
- [ ] **Step 5: Open the PR** to `master` with the summary, the follow-ups from spec §12, and a note on the two migrations. Do NOT merge without Bridger's explicit go-ahead.

---

## Self-Review

**Spec coverage:** §4 migration → Task 1; type + archived filter → Task 3; §5 permissions (RLS-only, `can_view_properties` gate, cross-permission delete gate) → Tasks 5/10; §6 nav/host/list/sheet/delete/shared → Tasks 2/5/6/7/8/10; §7.1 list → Task 6; §7.2/7.3 read/edit/create → Tasks 7/8; §7.4 delete model → Tasks 4/10; §7.5 book-from-property → Task 11; §7.6 inline add → Task 12; §7.7 customer deep-link → Task 13; §7.8 archived filter → Task 3; §8 reuse → Task 2 + throughout; §9 testing → Tasks 4/6/11 (unit) + Task 14 (E2E); §11 copy guardrails → Global Constraints. All spec sections map to a task.

**Placeholder scan:** No "TBD"/"add appropriate handling". UI tasks give exact reuse sources + interface contracts + behavior rather than every JSX line — deliberate for a lift-heavy build with fresh implementers who read the cited sources; pure logic has full test+impl code.

**Type consistency:** `PropertyDeletePlan.action` values (`hard-delete`/`cancel-and-archive`/`archive-only`) are consistent across Tasks 4 and 10; `PropertyFormValues`/`toNumberOrNull` from `@/lib/properties/validateProperty` consistent across Tasks 2/8; `buildPropertySeed` shape consistent across Tasks 11/12; `useOpenProperty` consistent across Tasks 6/7/13; `AdminProperty` gains `photo_url`/`archived_at` in Task 3 and is consumed in Tasks 4/6.

---

*Execution: subagent-driven (fresh implementer per task, spec+quality review per task, final whole-branch review), lean reviewer fan-out (one per task). Leave plan-doc edits as their own commit before an implementer runs `git add -A`.*
