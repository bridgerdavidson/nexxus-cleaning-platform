# Operator Properties Workspace (R4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a full Properties workspace in the redesigned console (list, create/edit/delete, photo, instructions, homeowner assignment, book-from-property) so self-pay orgs and phone-bookings-for-new-addresses stop dead-ending.

**Architecture:** Client-direct Supabase writes gated by existing RLS (no new routes). A top-level `Properties` nav tab renders a dense table (`OperatorProperties`); a shell-level `?property=` host (`OperatorPropertyDetailHost`, modeled on the `?booking=` host) opens a right-side `PropertyDetailSheet` (read → edit/create) from anywhere. Delete is a bucketed model that preserves history by archiving (soft-delete) rather than cascading. Two booking wires (seed-from-property, inline add-property) make it operational.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, Supabase (Postgres + RLS + Realtime + Storage), TanStack Query v5, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-07-11-operator-properties-workspace-design.md` (read it first — this plan implements it).

**Build order (dependency-correct):** infra/logic (T1-4) → sheet host + read (T5) → sheet edit/create (T6) → homeowner assign (T7) → nav+list (T8) → delete (T9) → book-from-property (T10) → inline add (T11) → customer deep-link (T12) → verify (T13). Each task typechecks and ships only functional UI; footer/row actions are added by the task that implements them, so no dead buttons or forward references at any commit.

## Global Constraints

Every task's requirements implicitly include these:

- **Branch:** `feat/operator-properties-workspace` (already created; spec `08726cf`, plan committed). Never commit to `master`.
- **Ship from the design system.** Implement every screen from `src/components/ui/*` + tokens (`tailwind.config.js`, `src/app/globals.css`): brand `#0150FC`, Plus Jakarta Sans, warm canvas, `rounded-card`/`rounded-control`, `shadow-soft-*`, semantic tokens (`bg-critical-50`, `text-critical-700`, `text-muted-foreground`, etc.). The browser-companion mockups under `.superpowers/brainstorm/` are UX/structure reference ONLY — never copy their inline hex/beige/blue styling. Status uses the badge/pill vocabulary, not decorative accent bars.
- **No em dashes** in any user-facing copy (labels, buttons, toasts, empty states, dialog text). Use periods, commas, parentheses, or "to".
- **Writes are client-direct + RLS.** Do NOT add a service-role property-write route or import `supabase-admin` in client code. RLS (migration 104) is the boundary.
- **No new deps.** Reuse existing primitives and hooks.
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Gates before "done" on any task:** `npx tsc --noEmit` shows no NEW errors (12 pre-existing baseline is OK), `npm run lint` clean on changed files, `npm run test:unit` green (the full `npm run test` hits a local GoTrue rate-limit; run targeted unit tests, CI is the source of truth). Pure-logic tasks add Vitest unit tests; UI tasks verify via tsc/lint + the report notes what the controller should browser-check.
- **No dead buttons.** Only render an action once its handler exists. Footer/row actions are added by the task that implements them.
- **Column facts (verbatim):** `properties(id, owner_id NULLABLE [NULL=org-owned], name, address, city, state, zip_code, bedrooms int, bathrooms int, square_feet int, special_instructions, access_instructions, photo_url, organization_id, created_at, updated_at)` + new `archived_at timestamptz`. `AppointmentStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'`. `recurring_appointment_series` has `property_id` + `is_active boolean`.

---

### Task 1: Migration — `archived_at` flag + realtime publication

**Files:**
- Create: `supabase/migrations/107_properties_archive_and_realtime.sql`

**Interfaces:**
- Produces: nullable `properties.archived_at timestamptz` (NULL = active); `properties` in the `supabase_realtime` publication.

- [ ] **Step 1: Write the migration.** Copy the publication-guard shape from `supabase/migrations/081_realtime_enable.sql`.

```sql
-- 107: Properties workspace (R4) — soft-delete/archive flag + realtime publication.

-- 1. Archive flag. NULL = active; a non-null timestamp = archived (hidden everywhere).
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
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'properties'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.properties';
  END IF;
END $$;
```

- [ ] **Step 2: Rebuild + verify.** Run `npx supabase db reset`; expected: all migrations apply, no error. Then confirm the column exists and `properties` is in the publication (Studio at :54323, or `psql \d public.properties` + a `pg_publication_tables` query). A clean `db reset` plus the column/publication check is sufficient.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/107_properties_archive_and_realtime.sql
git commit -m "feat(db): properties archived_at flag + realtime publication (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Promote shared property logic out of the homeowner namespace

**Files:**
- Move: `src/components/redesign/homeowner/account/properties/validateProperty.ts` → `src/lib/properties/validateProperty.ts`
- Move: `.../validateProperty.test.ts` → `src/lib/properties/validateProperty.test.ts`
- Move: `.../PropertyPhotoField.tsx` → `src/components/redesign/properties/PropertyPhotoField.tsx`
- Modify: every importer of the three moved files.

**Interfaces:**
- Produces: `@/lib/properties/validateProperty` (`PropertyFormValues`, `EMPTY_PROPERTY_FORM`, `validateProperty`, `toNumberOrNull`); `@/components/redesign/properties/PropertyPhotoField` (`PropertyPhotoField`).

- [ ] **Step 1: Find importers.** Run `grep -rln "properties/validateProperty\|properties/PropertyPhotoField\|from './validateProperty'\|from './PropertyPhotoField'" src/`. Note every hit (at least `PropertyFormSheet.tsx`).
- [ ] **Step 2: Move with `git mv`** (preserves history) into `src/lib/properties/` and `src/components/redesign/properties/` (mkdir first), then re-point each importer to `@/lib/properties/validateProperty` and `@/components/redesign/properties/PropertyPhotoField`.
- [ ] **Step 3: Verify.** Run `npm run test:unit -- validateProperty && npx tsc --noEmit`. Expected: validateProperty tests pass; no NEW tsc errors.
- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "refactor(properties): promote validateProperty + PropertyPhotoField to shared modules (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `Property` type extension + archived read filter across all property reads

**Files:**
- Modify: `src/types/index.ts` (Property type: add `photo_url: string | null`, `archived_at: string | null`)
- Modify: `src/hooks/useAdminData.ts` (`useAdminProperties` select + `AdminProperty` type; add `.is('archived_at', null)`); `useCustomerDetails` property select (archived filter)
- Modify: `src/components/redesign/bookings/new-booking/usePropertiesByOwner.ts` (archived filter)
- Modify: the homeowner property read behind `keys.properties.byHomeowner` (in `useHomeownerData.ts` / homeowner properties hook) — archived filter

**Interfaces:**
- Produces: no archived property is ever returned by any list/detail/picker query (operator or homeowner).

- [ ] **Step 1: Extend the type(s).** Add `photo_url: string | null;` and `archived_at: string | null;` to the Property interface in `src/types/index.ts` (near line 146) and to `AdminProperty` in `useAdminData.ts` if distinct.
- [ ] **Step 2: Add `.is('archived_at', null)` to every property READ.** Grep `grep -rn "from('properties')" src/` and add the filter to each SELECT that lists properties for display (list, customer detail, booking picker, homeowner). Do NOT filter in the id-scoped write helpers (`updateProperty`, delete/archive).
- [ ] **Step 3: Verify.** `npx tsc --noEmit` clean. Report the exact read sites changed so the controller can browser-confirm an archived row disappears.
- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "feat(properties): Property type gains photo_url/archived_at; exclude archived rows from all reads (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Delete-plan pure logic + `archiveOrDeleteProperty` executor (TDD)

**Files:**
- Create: `src/lib/properties/deletePlan.ts` + `src/lib/properties/deletePlan.test.ts`
- Modify: `src/hooks/useAdminData.ts` (add `archiveOrDeleteProperty` + `countPropertyAppointments`)

**Interfaces:**
- Produces: `type PropertyDeleteAction = 'hard-delete' | 'cancel-and-archive' | 'archive-only'`; `planPropertyDeletion(counts) → PropertyDeletePlan`; `archiveOrDeleteProperty(propertyId, orgId) → { success, action?, error? }`; `countPropertyAppointments(propertyId) → { liveCount, historyCount }`.
- Live statuses = `('pending','confirmed','in_progress')`; history = `('completed','cancelled')`.

- [ ] **Step 1: Failing tests for the planner.**

```ts
// src/lib/properties/deletePlan.test.ts
import { describe, it, expect } from 'vitest';
import { planPropertyDeletion } from './deletePlan';

describe('planPropertyDeletion', () => {
  it('hard-deletes a never-booked property', () => {
    expect(planPropertyDeletion({ liveCount: 0, historyCount: 0 })).toEqual({
      action: 'hard-delete', liveCount: 0, historyCount: 0, needsBookingEdit: false });
  });
  it('archives (no cancel) when only history exists', () => {
    expect(planPropertyDeletion({ liveCount: 0, historyCount: 3 })).toEqual({
      action: 'archive-only', liveCount: 0, historyCount: 3, needsBookingEdit: false });
  });
  it('cancels live cleanings then archives when live exist; needs booking-edit', () => {
    expect(planPropertyDeletion({ liveCount: 2, historyCount: 5 })).toEqual({
      action: 'cancel-and-archive', liveCount: 2, historyCount: 5, needsBookingEdit: true });
  });
  it('cancel-and-archive even with zero history when live exist', () => {
    expect(planPropertyDeletion({ liveCount: 1, historyCount: 0 })).toEqual({
      action: 'cancel-and-archive', liveCount: 1, historyCount: 0, needsBookingEdit: true });
  });
});
```

- [ ] **Step 2: Run to verify fail.** `npm run test:unit -- deletePlan` → FAIL ("planPropertyDeletion is not a function").
- [ ] **Step 3: Implement the planner.**

```ts
// src/lib/properties/deletePlan.ts
export type PropertyDeleteAction = 'hard-delete' | 'cancel-and-archive' | 'archive-only';
export interface PropertyDeletePlan { action: PropertyDeleteAction; liveCount: number; historyCount: number; needsBookingEdit: boolean; }
export const LIVE_APPT_STATUSES = ['pending', 'confirmed', 'in_progress'] as const;
export const HISTORY_APPT_STATUSES = ['completed', 'cancelled'] as const;

export function planPropertyDeletion(counts: { liveCount: number; historyCount: number }): PropertyDeletePlan {
  const { liveCount, historyCount } = counts;
  if (liveCount === 0 && historyCount === 0) return { action: 'hard-delete', liveCount, historyCount, needsBookingEdit: false };
  if (liveCount === 0) return { action: 'archive-only', liveCount, historyCount, needsBookingEdit: false };
  return { action: 'cancel-and-archive', liveCount, historyCount, needsBookingEdit: true };
}
```

- [ ] **Step 4: Run to verify pass.** `npm run test:unit -- deletePlan` → PASS.
- [ ] **Step 5: Implement the executor + counter in `useAdminData.ts`** (below `deleteProperty`). All via the anon client so RLS applies (property UPDATE/DELETE → `can_edit_properties`; appointment UPDATE → `can_edit_bookings`).

```ts
import { planPropertyDeletion, LIVE_APPT_STATUSES } from '@/lib/properties/deletePlan';

export async function countPropertyAppointments(propertyId: string) {
  const [{ count: live }, { count: history }] = await Promise.all([
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).in('status', LIVE_APPT_STATUSES as unknown as string[]),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).in('status', ['completed', 'cancelled']),
  ]);
  return { liveCount: live ?? 0, historyCount: history ?? 0 };
}

/**
 * Delete a property safely (R4). Never-booked → hard delete. Any history →
 * cancel live cleanings + stop active recurring series, then archive (soft-delete)
 * so completed/cancelled records still resolve. Returns the action taken.
 */
export async function archiveOrDeleteProperty(propertyId: string, organizationId: string) {
  try {
    const { data: property, error: checkError } = await supabase
      .from('properties').select('organization_id').eq('id', propertyId).single();
    if (checkError) throw checkError;
    if (!property || property.organization_id !== organizationId) {
      return { success: false, error: 'Property not found or does not belong to this organization' };
    }
    const { liveCount, historyCount } = await countPropertyAppointments(propertyId);
    const plan = planPropertyDeletion({ liveCount, historyCount });

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
      const { error: seriesErr } = await supabase.from('recurring_appointment_series')
        .update({ is_active: false }).eq('property_id', propertyId).eq('is_active', true);
      if (seriesErr) throw seriesErr;
    }
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

- [ ] **Step 6: Verify.** `npx tsc --noEmit && npm run test:unit -- deletePlan` → clean + pass.
- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(properties): safe delete planner + archiveOrDeleteProperty executor (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `OperatorPropertyDetailHost` (`?property=`) + read-only detail sheet

**Files:**
- Create: `src/components/redesign/properties/useOpenProperty.ts` (operator `?property=` opener; model on `useOpenBookingDetail`/`useOpenOperatorBooking`)
- Create: `src/components/redesign/properties/OperatorPropertyDetailHost.tsx`
- Create: `src/components/redesign/properties/PropertyDetailSheet.tsx` (READ mode only this task)
- Modify: `src/components/redesign/shell/OperatorShell.tsx` (mount the host, gated `can_view_properties`, exactly like the `?booking=` host)

**Interfaces:**
- Consumes: `useAdminProperties()` (resolve `?property=` id to an `AdminProperty`), `Sheet`/`SheetContent side="right"`, shared `Field` from `@/components/redesign/bookings/detail-atoms`, `useManagerPermissions`.
- Produces: `useOpenProperty()` → `{ open(id): void; close(): void }` (merges `window.location.search` at call time, like `useOpenBookingDetail`, preserving other params); the host that renders `PropertyDetailSheet` when `?property=` is present; `PropertyDetailSheet` read mode.

- [ ] **Step 1: Study the booking host.** Read `OperatorBookingDetailHost.tsx` + `useOpenBookingDetail`/`useOpenOperatorBooking` to copy the single-param-owner pattern (opener merges existing search params; host reads the param + renders the sheet; close removes it).
- [ ] **Step 2: Implement `useOpenProperty`** as the `?property=` analog.
- [ ] **Step 3: Implement the read-mode sheet.** `Sheet` + `SheetContent side="right" className="… sm:max-w-md"`. Sections (spec §7.2): hero photo (or a `Building2` placeholder) → name + full address → Homeowner (avatar+name+email, or an `Org-owned` badge when `owner_id` null) → Details (bd/ba/sqft) → Special instructions → Access instructions. Read rows via the shared `Field`. **No footer action buttons this task** (Edit/Book/Delete are added by Tasks 6/9/10). Include only the standard sheet close affordance.
- [ ] **Step 4: Mount the host in `OperatorShell`** next to the booking host, gated `can_view_properties` via `useManagerPermissions`.
- [ ] **Step 5: Verify.** `npx tsc --noEmit && npm run lint`. Report: opening `?property=<id>` (append to any operator page URL, e.g. `/app/admin-dashboard/customers?property=<id>`) renders the read sheet for the controller to browser-check.
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(operator): shell-level ?property= host + read-mode property sheet (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `PropertyDetailSheet` edit + create modes (Edit button, save-when-dirty, photo-after-save)

**Files:**
- Modify: `src/components/redesign/properties/PropertyDetailSheet.tsx`
- Reference (lift logic, do NOT re-fork): `src/components/redesign/homeowner/account/properties/PropertyFormSheet.tsx`

**Interfaces:**
- Consumes: `validateProperty`, `EMPTY_PROPERTY_FORM`, `toNumberOrNull`, `PropertyFormValues` (`@/lib/properties/validateProperty`); `updateProperty` (`@/hooks/useAdminData`); `PropertyPhotoField` (`@/components/redesign/properties/PropertyPhotoField`); `FormField`, `Input`, `Textarea`, `DiscardChangesDialog` (`bookings/detail-atoms`), `toast`, `keys` (`@/lib/queryKeys`).
- Produces: an in-sheet edit mode (Edit button in the footer) + a create entry point (`PropertyDetailSheet` opened with no property, e.g. `mode="create"` with an optional pre-set `owner_id`); `onSaved` callback. The create opener is wired by Tasks 8/11.

- [ ] **Step 1: Add edit mode.** Toggle read↔edit like `CustomerDetailSheet` (`canEdit/editing/onEditingChange`). Add the **Edit** button to the footer (this is where the footer's first action appears). Fields (lift `fromProperty` + payload from `PropertyFormSheet.tsx:29-42,107-118`): name*, address*, city*, state*, zip_code* (required via `validateProperty`), bedrooms/bathrooms/square_feet (`inputMode="numeric"`, `toNumberOrNull`), special_instructions, access_instructions (`Textarea`). Label special instructions "Special instructions" (operator wording).
- [ ] **Step 2: Save = disabled-until-dirty.** Track dirty (form vs loaded property); disable Save when clean. Save calls `updateProperty(id, { ...payload, photo_url })`; success → `toast.success('Property updated')`, invalidate `keys.properties.byOrg(orgId)` + `keys.customers.byOrg(orgId)`, exit edit. Failure → surface error. Dirty-close → `DiscardChangesDialog`.
- [ ] **Step 3: Add create mode.** Empty form; insert via `supabase.from('properties').insert({ ...payload, owner_id: <ownerOrNull>, organization_id })` (lift from `PropertyFormSheet.tsx:125-131` but set `owner_id` from the create context, not `user.id`). **Photo control only after first save** — render `PropertyPhotoField` only when a property id exists; in create show the affordance "Save this property first to add a photo." On create success, invalidate the org properties key and open the new property in edit mode so the photo field appears.
- [ ] **Step 4: Verify.** `npx tsc --noEmit && npm run lint`. Report the create/edit/save/photo/dirty-guard behavior for the controller to browser-check (create reachable via a temporary `?property=new` or by the Task 8 list button once it lands).
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): property create/edit in the detail sheet, save-when-dirty + photo-after-save (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Homeowner assign / change / remove block

**Files:**
- Modify: `src/components/redesign/properties/PropertyDetailSheet.tsx` (assignment block in edit mode)
- Create (if no reusable picker exists): `src/components/redesign/properties/HomeownerAssignField.tsx`

**Interfaces:**
- Consumes: a query of org members with `organization_members.role='homeowner'` (reuse the customers list hook if one exposes it, else a small query keyed `keys.customers.byOrg`); `stripeSelfPayUiEnabled()` (find the existing flag helper); `updateProperty` for the `owner_id` write (extend its signature to accept `owner_id?: string | null`).
- Produces: setting/clearing `owner_id` on the property.

- [ ] **Step 1: Gate the block** on `stripeSelfPayUiEnabled()` AND `can_edit_properties` (mirror legacy `PropertySidePanel`).
- [ ] **Step 2: Assigned state.** Homeowner avatar/name/email + `Change` and `Remove`. `Remove` → `updateProperty(id, { owner_id: null })` (property becomes Org-owned).
- [ ] **Step 3: Unassigned state.** `Org-owned` + `Assign homeowner` picker (search org homeowners); selecting writes `owner_id`.
- [ ] **Step 4: Verify.** `npx tsc --noEmit && npm run lint`. Report assign/change/remove for the controller to browser-check (badge flips to Org-owned on remove via realtime invalidation).
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): assign/change/remove homeowner on a property (org-owned on remove) (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Properties nav item + route + list

**Files:**
- Modify: `src/components/redesign/shell/nav-items.ts` (add item + `Building2` import) + `nav-items.test.ts` (expectations)
- Create: `src/app/(redesign)/app/admin-dashboard/properties/page.tsx`
- Create: `src/components/redesign/properties/OperatorProperties.tsx`
- Create: `src/components/redesign/properties/propertyRowVM.ts` + `.test.ts`

**Interfaces:**
- Consumes: `useAdminProperties()`, `useOpenProperty()` (Task 5), the create-mode `PropertyDetailSheet` (Task 6), `useRequireManagerFlag`, `useManagerPermissions`, `ListFilterBar`, `Skeleton`, `EmptyState`, `ErrorState`, `Badge`, `DropdownMenu`.
- Produces: the Properties destination + list; row-click opens the read sheet; row menu "Edit" opens edit mode; "Add property" opens create mode. (Book/Delete row items are added by Tasks 9/10.)

- [ ] **Step 1: Nav item + test.** In `nav-items.ts`, import `Building2` and add after the Calendar item: `{ id: "properties", label: "Properties", href: "/app/admin-dashboard/properties", icon: Building2, requires: "can_view_properties" }`. Update `nav-items.test.ts` for the new item (`npm run test:unit -- nav-items`, adjust expectations).
- [ ] **Step 2: Page.** Copy the exact shape of `src/app/(redesign)/app/admin-dashboard/calendar/page.tsx`, swapping guard to `useRequireManagerFlag('can_view_properties')`, `active="properties"`, child `<OperatorProperties/>`.
- [ ] **Step 3: Row VM (pure) + failing test.**

```ts
// propertyRowVM.ts
import type { AdminProperty } from '@/hooks/useAdminData';
export interface PropertyRowVM { id: string; name: string; addressLine: string; ownerLabel: string; isOrgOwned: boolean; detailsLabel: string; photoUrl: string | null; }
export function toPropertyRowVM(p: AdminProperty): PropertyRowVM {
  const isOrgOwned = !p.owner_id;
  const ownerLabel = isOrgOwned ? 'Org-owned' : [p.homeowner?.first_name, p.homeowner?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const details = [p.bedrooms != null ? `${p.bedrooms} bd` : null, p.bathrooms != null ? `${p.bathrooms} ba` : null, p.square_feet != null ? `${p.square_feet.toLocaleString()} sf` : null].filter(Boolean).join(' · ');
  return { id: p.id, name: p.name, addressLine: [p.address, p.city, p.state].filter(Boolean).join(', '), ownerLabel, isOrgOwned, detailsLabel: details || 'No details', photoUrl: p.photo_url ?? null };
}
```

Test both owner branches + null-details fallback; run `npm run test:unit -- propertyRowVM` (fail → pass).

- [ ] **Step 4: List component.** Mirror `OperatorCustomers.tsx` (list↔sheet, `ListFilterBar`, states). Table columns (spec §7.1): thumbnail(`photo_url` w/ `Building2` fallback)+name / address / homeowner-or-`Org-owned` badge / details / row `DropdownMenu`. Search filters name+address; segmented filter All/Homeowner/Org-owned. `Skeleton` while loading, `ErrorState`(retry) on error, `EmptyState` ("No properties yet." + "Add property") when empty. Below the mobile breakpoint render stacked cards, not a horizontally-scrolled table. Gate "Add property" and the row "Edit" on `can_edit_properties`. Row click → `useOpenProperty().open(id)`; row menu "Edit" → open in edit mode; "Add property" → open create mode. Row menu contains ONLY Edit for now (Book/Delete added in Tasks 9/10).
- [ ] **Step 5: Verify.** `npx tsc --noEmit && npm run test:unit -- nav-items propertyRowVM && npm run lint`. Report for the controller to browser-check (list renders, filters, states, row-open, add-property).
- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(operator): Properties nav destination + list (filter, states, open + add) (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `PropertyDeleteDialog` + Delete affordance

**Files:**
- Create: `src/components/redesign/properties/PropertyDeleteDialog.tsx`
- Modify: `PropertyDetailSheet.tsx` (add the Delete footer button, opens the dialog) + `OperatorProperties.tsx` (add "Delete" to the row menu)

**Interfaces:**
- Consumes: `countPropertyAppointments`, `archiveOrDeleteProperty`, `planPropertyDeletion` (Task 4); `useManagerPermissions().permissions.can_edit_bookings` + `can_edit_properties`; `Dialog`/`ConfirmDialog`, `toast`, `keys`.
- Produces: the delete flow (spec §7.4).

- [ ] **Step 1: On open, fetch counts + plan.** Call `countPropertyAppointments(propertyId)`; `plan = planPropertyDeletion(counts)`.
- [ ] **Step 2: Render by action** (no em dashes):
  - `hard-delete`: "Delete <name>? No cleanings on record. This is permanent and can't be undone." → `archiveOrDeleteProperty`.
  - `archive-only`: "Delete <name>? Past cleanings stay on record. The property is archived so history still resolves." → `archiveOrDeleteProperty`.
  - `cancel-and-archive`: warning card — "This property has N upcoming cleanings that will be cancelled. Past and cancelled cleanings stay on record. The property is archived." **If `!can_edit_bookings`**, disable confirm + show "Removing the upcoming cleanings needs booking-edit permission. Ask an admin, or cancel those cleanings first." → `archiveOrDeleteProperty`.
- [ ] **Step 3: On success** `toast.success` (per action), close the sheet, invalidate `keys.properties.byOrg` + `keys.customers.byOrg` (+ `keys.appointments.all` when live cleanings were cancelled). Failure → `toast.error`. Gate the Delete affordances on `can_edit_properties`.
- [ ] **Step 4: Verify.** `npx tsc --noEmit && npm run lint`. Report for controller browser-check: seed a property with an upcoming appointment (warning card, override cancels + archives), a never-booked property (hard delete), a manager without `can_edit_bookings` (disabled override).
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): property delete dialog (warn+override, cancel-upcoming+archive, permission-gated) (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Book-from-property seeding + Book affordance

**Files:**
- Create: `src/components/redesign/bookings/new-booking/seedFromProperty.ts` + `.test.ts`
- Modify: operator new-booking param contract (`operatorBookingParams` + `useOpenOperatorBooking.ts`), `OperatorBookingHost.tsx`, `OperatorBookingForm.tsx` (initializer ~`:61-76`, billTo reset ~`:194-214`); `PropertyDetailSheet.tsx` (Book footer button) + `OperatorProperties.tsx` (row "Book")

**Interfaces:**
- Produces: `buildPropertySeed(p) → { customerId?: string; propertyId: string; billTo }`; extended `?newbooking=` params carrying `customerId`/`propertyId`/`billTo`; Book affordance in the sheet footer + list row.

- [ ] **Step 1: TDD the seed builder.** Homeowner-owned → `{ customerId: owner_id, propertyId, billTo: 'customer' }`; org-owned (null owner) → `{ propertyId, billTo: 'company' }`. Confirm the real billTo values `OperatorBookingForm` uses and match them exactly. Write `seedFromProperty.test.ts` (fail → implement `buildPropertySeed` → pass).
- [ ] **Step 2: Extend the param contract.** Add `customerId`, `propertyId`, `billTo` to `operatorBookingParams` + opener; read them in `OperatorBookingHost`; seed `state` in the form initializer. **Set `billTo` before `customerId`/`propertyId`** (or guard the reset effect) so the billTo-flip reset doesn't clobber the seed.
- [ ] **Step 3: Add the Book affordance.** `PropertyDetailSheet` footer "Book cleaning" (primary) + list row "Book" → `useOpenOperatorBooking().open(buildPropertySeed(property))`.
- [ ] **Step 4: Verify.** `npx tsc --noEmit && npm run test:unit -- seedFromProperty && npm run lint`. Report for browser-check: book from a homeowner property (customer+property prefilled), from an org-owned property (company bill-to).
- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(operator): book-from-property seeds the new-booking sheet (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Inline add-property for zero-property customers

**Files:**
- Modify: `src/components/redesign/bookings/new-booking/OperatorBookingForm.tsx` (property picker empty state ~`:228-237`), `usePropertiesByOwner.ts`

**Interfaces:**
- Consumes: the create-mode `PropertyDetailSheet` (Task 6), `usePropertiesByOwner`.
- Produces: inline create + auto-select in the picker.

- [ ] **Step 1: Empty-state action.** When the picker has no properties for the selected customer, render "+ Add a property" that opens the create sheet pre-seeded with the current `customerId` as `owner_id`.
- [ ] **Step 2: On create success, refresh + select.** Invalidate `usePropertiesByOwner`'s key (`['operator-booking','properties-by-owner',orgId,ownerId]`) and auto-select the new property id in the form.
- [ ] **Step 3: Verify.** `npx tsc --noEmit && npm run lint`. Report for browser-check: a zero-property customer, add inline, auto-selects, booking proceeds.
- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "feat(operator): inline add-property in the zero-property booking picker (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: `CustomerDetailSheet` property deep-link

**Files:**
- Modify: `src/components/redesign/customers/CustomerDetailSheet.tsx` (property cards ~`:208-221`) + its presenter props / VM in `OperatorCustomers.tsx`

**Interfaces:**
- Consumes: `useOpenProperty()` (Task 5).
- Produces: clicking a customer's property card opens the property sheet in place (`?property=<id>`), preserving the customer context.

- [ ] **Step 1: Add the affordance.** Make each read-only property card actionable, calling `useOpenProperty().open(p.id)`. Thread an `onOpenProperty` handler through the presenter props (the sheet is a dumb presenter; the container wires the opener). Cards stay read-only otherwise.
- [ ] **Step 2: Verify.** `npx tsc --noEmit && npm run lint`. Report for browser-check: from a customer with properties, click a property card → property sheet opens over the Customers page; closing returns to the customer sheet with `?c=` intact.
- [ ] **Step 3: Commit.**

```bash
git add -A
git commit -m "feat(operator): customer property cards deep-link into the Properties workspace (R4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Full verification pass + ui-ux-pro-max conformance + optional E2E

**Files:**
- Create (optional): `tests/e2e/operator-properties.spec.ts`

- [ ] **Step 1: Gates.** `npm run test` (green — or targeted `npm run test:unit` + note the local integration rate-limit; CI is the source of truth), `npx tsc --noEmit` (only the 12 pre-existing baseline errors), `npm run lint` (clean on changed files), `npx supabase db reset` (schema rebuilds, integration tests still pass).
- [ ] **Step 2: ui-ux-pro-max implementation-phase conformance.** Run the skill against the built Properties components; fix flagged off-system styling (raw hex, non-token colors, touch targets, focus/disabled states). Grep the new files for stray hex to confirm no mockup styling leaked.
- [ ] **Step 3: Browser walkthrough (screenshots to Bridger).** List (table + filters + empty/loading/error, mobile cards), read/edit/create sheet, photo-after-save, homeowner assign/change/remove, delete (all three actions + permission-gated override), book-from-property, inline add-property, customer deep-link. No console errors, no legacy `/admin-dashboard?tab=` escapes.
- [ ] **Step 4 (optional): E2E happy path** in `tests/e2e/` (open → create → edit → book-from-property), scoped against existing patterns.
- [ ] **Step 5: Open the PR** to `master` with the summary, spec §12 follow-ups, and the two migrations note. Do NOT merge without Bridger's explicit go-ahead.

---

## Self-Review

**Spec coverage:** §4 migration → T1; type + archived filter → T3; §5 permissions → T5/T8/T9; §6 nav/host/list/sheet/delete/shared → T2/T5/T6/T8/T9; §7.1 list → T8; §7.2/7.3 read/edit/create → T5/T6; §7.4 delete → T4/T9; §7.5 book-from-property → T10; §7.6 inline add → T11; §7.7 deep-link → T12; §7.8 archived filter → T3; §8 reuse → T2 + throughout; §9 testing → T4/T8/T10 unit + T13 E2E; §11 copy → Global Constraints. All spec sections map to a task.

**Placeholder scan:** No "TBD"/"add appropriate handling". UI tasks give exact reuse sources + interface contracts + behavior; pure logic has full test+impl code.

**Type consistency:** `PropertyDeleteAction` values consistent across T4/T9; `PropertyFormValues`/`toNumberOrNull` (`@/lib/properties/validateProperty`) consistent T2/T6; `buildPropertySeed` shape consistent T10/T11; `useOpenProperty` consistent T5/T8/T12; `AdminProperty` gains `photo_url`/`archived_at` in T3, consumed T4/T8; `PropertyDetailSheet` footer grows Edit(T6)→Delete(T9)→Book(T10) with no dead intermediate button.

---

*Execution: subagent-driven (fresh implementer per task, spec+quality review per task, final whole-branch review), lean reviewer fan-out (one per task). Leave plan-doc edits as their own commit before an implementer runs `git add -A`.*
