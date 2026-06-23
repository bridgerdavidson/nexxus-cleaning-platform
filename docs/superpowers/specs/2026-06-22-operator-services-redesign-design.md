# Operator Services screen (redesign) — design

**Date:** 2026-06-22
**Branch:** `feat/redesign-operator-services` (off `master`, worktree `.claude/worktrees/redesign-services`)
**Status:** Approved design, ready for implementation plan

## 1. Goal

Rebuild the Services management experience for operators (owner / admin / manager)
on the redesign foundation, from scratch, reusing **nothing** from the legacy
Services UI. It must feel native to the already-shipped redesign operator screens
(Overview, Bookings, Customers).

**The one behavior change to make (and not repeat):** eliminate the middle hop.

- **Legacy flow:** services list → click a service → `ServiceDetailView` (basic
  info only) → click a separate "Checklists" button → `ChecklistsView`.
- **New flow:** pick a service and its full detail **plus every checklist** is
  shown together immediately. No intermediate detail screen, no "Checklists"
  button, no extra navigation.

Everything else is a faithful, restyled re-implementation of the current feature
set, plus three chosen upgrades (section 9).

## 2. Domain model (why checklists matter)

This is the mental model the screen is built around; it is **not** changing.

- `service_types` (a "service"): `id`, `organization_id`, `name`, `description`,
  `base_price` (numeric), `duration_minutes` (int), `service_type` (free-form
  text, e.g. `regular`/`deep`/`move_out`), `is_active` (bool), timestamps.
- `checklists` (a "tier / add-on" of a service): `id`, `name`, `service_type_id`
  (FK, cascade), `price_adder` (numeric, ≥ 0), timestamps. A service has one or
  more checklists.
- `checklist_line_items` (a "task"): `id`, `task` (text), `checklist_id` (FK,
  cascade), `position` (int, nullable — nulls sort last), `created_at`.

A checklist is effectively a **selectable tier/add-on** of a service: each carries
its own task list and a `price_adder`. At booking, exactly one checklist is
attached to the appointment (`appointments.checklist_id`), and the price is
`base_price + that checklist's price_adder`. The "max checklist adder" across a
service's checklists is what produces the **price range** (`$120–$160`) shown on
cards today. The new UI keeps the word "Checklist" but presents them as the tiers
they are.

### Important existing behaviors to preserve

- **Auto "Default Checklist" on create:** a DB trigger
  (`create_default_checklist_for_service`) fires on `service_types` INSERT and
  seeds a "Default Checklist" with 9 starter tasks. Keep this; the create flow
  relies on it.
- **Delete protection:** `deleteService` is blocked when the service is used by any
  `appointments` or `recurring_appointment_series`; the UI recommends disabling
  (toggling `is_active=false`) instead. Keep this exactly.
- **Active/inactive toggle** is immediate/optimistic (no confirm).
- **Org scoping + RLS:** all CRUD is org-scoped via RLS (admin/manager/owner can
  mutate; any member can view). There are **no `/api` routes** for services or
  checklists — all reads/writes are direct Supabase client calls inside the hooks.

## 3. Layout & information architecture

**Two-pane master–detail**, inside the standard `OperatorShell` (`active="services"`),
anchored-left at `max-w-[1700px]`, vertical rhythm `space-y-5`. No KPI row (per the
established list/find-page rule — KPI strips are for Overview, not list pages).

```
Services                                          [+ New service]
12 services · 9 active                 (live-count subtitle in header)
search...............   [Sort: Name v]   [Status: Active v]

┌── list (~340px) ──┐  ┌── detail pane (flex) ────────────────────────┐
│  ▸ Standard Clean │  │ Standard Clean        [Active] [Edit] [ ⋯ ]  │
│    $120–$160 · 90m│  │ $120 base · 90 min · regular                  │
│    Deep Clean     │  │ ───────────────────────────────────────────  │
│    $200 · 3h      │  │ Checklists (tiers)              [+ Checklist] │
│    Move-out Clean │  │ ┌ ⠿ Standard       +$0    [✎][⧉][🗑] ───────┐ │
│    $260–$300 · 4h │  │ │   ⠿ Wear gloves            [✎] [🗑]       │ │
│                   │  │ │   ⠿ Empty all trash        [✎] [🗑]       │ │
│                   │  │ │   + Add task                              │ │
│                   │  │ └──────────────────────────────────────────┘ │
│                   │  │ ┌ ⠿ Inside fridge   +$20  [✎][⧉][🗑] ───────┐ │
└───────────────────┘  └───────────────────────────────────────────────┘
```

- **Top toolbar (search-hero):** live search box; a **Sort** control
  (Name / Recently updated / Price); a **Status** filter (Active / All / Inactive);
  primary **`+ New service`** button. Header shows a **live count** subtitle
  ("12 services · 9 active").
- **Left pane (~340px):** compact, selectable list of services. Each row: name, a
  price chip (range or single), duration, and a small status indicator. Selected row
  highlighted (brand). Inactive services muted (lower emphasis), still selectable.
- **Right pane (flex):** the selected service's detail —
  - **Header:** name, `StatusPill` (active/inactive), `base_price` · duration ·
    type, and an actions cluster: `Edit`, an active/inactive `Switch` (or toggle
    button), and a `⋯` `DropdownMenu` with **Duplicate service** and **Delete**.
  - **Checklists section:** each checklist is a draggable **`ChecklistCard`** (a
    tier) showing name, `+$adder`, a drag handle, and `✎`/`⧉`(duplicate)/`🗑`
    actions; inside it the **draggable tasks** and an `+ Add task` affordance.
    `+ Add checklist` at the bottom of the section.
- **Selection lives in the URL** as `?service=<id>` so reload-restore and
  deep-links work (legacy did this; the redesign favors it too). On first load with
  no param, auto-select the first service (desktop only).
- **Mobile / narrow:** when `?service` is unset, the list is full-width; tapping a
  service sets `?service` and the **detail renders full-screen** with a **‹ Back**
  affordance back to the list. Same components, responsive switch (single
  breakpoint, e.g. `lg`).

## 4. Component architecture

Follows the shipped **Container / pure-View / pure-derive (+ tests)** split used by
Bookings and Customers. The Container owns hooks, state, mutations, and view-model
construction; the View and its children are pure functions of props.

```
src/app/(redesign)/app/admin-dashboard/services/page.tsx
    thin "use client" wrapper — mirrors customers/page.tsx exactly:
    auth gate + Spinner + WorkspaceErrorScreen, OperatorShell active="services",
    onNewBooking → router.push("/admin-dashboard?tab=bookings"), renders <OperatorServices/>

src/components/redesign/services/
  OperatorServices.tsx        outer permission gate → inner <OperatorServicesData/>
                              (gate decides view-only vs manage vs access-denied
                              BEFORE the data component with hooks renders)
  OperatorServicesView.tsx    pure: header + toolbar + two-pane layout + empty/loading
  ServicesList.tsx            pure: left selectable list (desktop pane + mobile list)
  ServiceDetailPane.tsx       pure-ish: header + actions cluster + <ChecklistsEditor/>
  ChecklistsEditor.tsx        dnd-kit: draggable list of <ChecklistCard/> + add-checklist
  ChecklistCard.tsx           one tier: header (drag handle, name, +$adder, ✎/⧉/🗑)
                              + dnd-kit draggable tasks + add-task (incl. bulk paste)
  SortableTask.tsx            one task row (useSortable): drag handle, inline edit, delete
  ServiceFormDialog.tsx       create/edit service (ui/dialog + form-field/input/select/textarea/switch)
  ChecklistFormDialog.tsx     create/edit checklist (name + price_adder)
  DeleteServiceDialog.tsx     confirm-dialog + in-use protection ("disable instead")
  DeleteChecklistDialog.tsx   confirm-dialog + cascade item-count warning
  deriveServices.ts           pure helpers (see section 6)
  deriveServices.test.ts      unit tests for the pure helpers
  services-types.ts           ServiceRowVM, ServiceDetailVM, ChecklistVM, TaskVM, enums
  services-presenters.tsx     StatusPill mapping + price-label presenters
```

Built entirely from `src/components/ui/*` primitives: `Card`, `Button`, `IconButton`,
`Badge`/`StatusPill`, `Input`, `Textarea`, `Select`, `Switch`, `Dialog`,
`DropdownMenu`, `ConfirmDialog`, `EmptyState`, `Skeleton`, `Separator`, `Tooltip`,
`FormField`/`Label`. Drag-and-drop uses the in-repo `@dnd-kit/{core,sortable,utilities}`.
No legacy Services component is imported. Semantic tokens only (no hardcoded Tailwind
colors), redesign radii (`rounded-card`/`rounded-field`/`rounded-pill`) and
`shadow-soft-*`.

## 5. Data layer (reuse + small additions)

Reuse `useServices`, `useService`, `useChecklists` — they already provide TanStack
Query caching and realtime sync for `service_types`, `checklists`, and
`checklist_line_items`, so realtime updates come along for free (the earlier
redesign screens hadn't wired realtime; reusing these hooks means Services does have
it). Query keys via `src/lib/queryKeys.ts`.

### New migration — `090_checklist_position.sql`

- `ALTER TABLE checklists ADD COLUMN position int;` (nullable, nulls sort last, to
  match the line-item convention).
- Backfill deterministically:
  `position = row_number() over (partition by service_type_id order by name) - 1`.
- `checklists` already has `REPLICA IDENTITY FULL` and is in the realtime
  publication, so no extra realtime wiring.
- New checklist sort everywhere: `position` asc (nulls last) then `name`.
- Verify with `npx supabase db reset` (rebuilds clean) before pushing.

### `useChecklists.ts` additions

- `reorderChecklists(serviceTypeId, orderedIds[])` — sequential `position` writes,
  0-indexed, same shape/rollback contract as the existing `reorderLineItems`.
- `duplicateChecklist(checklistId)` — clone the checklist (name suffixed e.g.
  "(copy)", same `price_adder`, appended `position`) **and** clone all of its line
  items in order.
- `createLineItems(checklistId, tasks: string[])` — bulk insert for the multiline
  paste add-task path (trims, drops blank lines; appends after existing items).
- Sort checklists by `position` (nulls last) then `name` in the hook's selector.

### `useServices.ts` addition

- `duplicateService(orgId, serviceId)` — clone the `service_types` row (name
  suffixed "(copy)", `is_active` inherited), then clone its checklists + tasks.
  **Trigger gotcha (must handle):** inserting the cloned service fires
  `create_default_checklist_for_service`, which seeds an unwanted "Default
  Checklist". The duplicate flow must **delete that auto-created default checklist
  first**, then copy the source service's real checklists (with their tasks and
  positions). Otherwise the clone gets a stray empty default.

## 6. Pure helpers (`deriveServices.ts`) — the testable core

- `filterServices(services, { search, status })` — `status` ∈ `active|all|inactive`;
  search matches name / service_type / description (lowercased substring). Returns a
  **new** array (never mutates input).
- `sortServices(list, sort)` — `sort` ∈ `name|recent|price`: name = localeCompare;
  recent = `updated_at` desc; price = `base_price` asc. Operates on a copy.
- `serviceToRowVM` / `serviceToDetailVM` — map records → view models, including the
  price-range label.
- `priceRangeLabel(base, maxAdder)` — `base` alone when `maxAdder === 0`, else
  `"$base – $(base+maxAdder)"`; money formatting consistent with the other redesign
  screens (tabular numerals).
- `sortChecklists(checklists)` — position (nulls last) then name.
- `reindexAfterReorder(orderedIds)` / task equivalent — produce the 0-indexed
  `position` map sent to `reorderChecklists` / `reorderLineItems`.

These get unit tests (`deriveServices.test.ts`): filtering, each sort, price-range
edge cases (0 adder, multiple tiers), checklist sort with null positions, reorder
reindex math.

## 7. Interactions

- **Reorder tasks** and **reorder checklists** via dnd-kit (`DndContext` +
  `SortableContext` + `useSortable`, `verticalListSortingStrategy`,
  `closestCenter`, keyboard sensor for a11y). Optimistic UI patch then persist;
  rollback + toast on error — mirrors the proven `reorderLineItems` pattern.
- **Inline task edit:** ✎ → input prefilled + autofocus; Enter/Save commits,
  Esc/Cancel reverts; empty task rejected. One task edited at a time.
- **Add task:** inline input at the bottom of a checklist; Enter or Add commits.
  **Bulk-add:** if the input contains multiple lines (paste), each non-blank line
  becomes its own task via `createLineItems`.
- **Delete task:** 🗑 with light inline confirm (no full modal needed for a task).
- **Create / Edit service** (`ServiceFormDialog`): name (required), description
  (textarea), base_price (number ≥ 0), duration_minutes (int ≥ 1), service_type
  (input with the existing suggestion set: regular/deep/move_out/move_in/custom/
  one_time/recurring/seasonal/office/commercial), active switch. **Drop** the
  legacy RLS-diagnostic debug panel; use clean redesign error states (inline
  `aria-invalid` + a toast on failure).
- **Create / Edit checklist** (`ChecklistFormDialog`): name (required, autofocus),
  price_adder (number ≥ 0, default 0).
- **Duplicate service** / **Duplicate checklist** via the respective `⋯` menus.
- **Active/inactive toggle:** optimistic, no confirm.
- **Delete service** (`DeleteServiceDialog`): runs `canDeleteService`; if in use,
  block with the "disable instead" guidance; otherwise confirm. **Delete checklist**
  (`DeleteChecklistDialog`): confirm with the cascade task-count warning.
- **Discard guard** on the form dialogs when dirty (reuse the app's
  dismiss-guard/confirm pattern), consistent with the rest of the app.

## 8. States & gating

- **Loading:** list + detail skeletons (`Skeleton`).
- **Empty (no services):** `EmptyState` with a `+ New service` action.
- **No selection (desktop, has services):** auto-select first service, so this is
  rare; if it occurs, a quiet "Select a service" hint in the right pane.
- **Empty checklist:** per-card hint ("No tasks yet — add the first one").
- **Permission gating (outer gate + inner Data, permission-before-fetch):**
  - owner / admin → full manage.
  - manager with `can_manage_services` → full manage.
  - manager with only `can_view_services` (not manage) → **read-only**: list +
    detail + checklists render, but every mutate affordance (New/Edit/Delete/Add/
    drag handles/toggles/duplicate) is hidden.
  - otherwise → access-denied `EmptyState`.
  - This mirrors `OperatorCustomers`' outer-gate / inner-`Data` structure; the gate
    resolves before the hooks-bearing inner component mounts (no granted→denied
    flicker).

## 9. Chosen upgrades (beyond parity)

1. **Duplicate a service** (clone with all checklists + tasks) — `duplicateService`.
2. **Duplicate a checklist** within a service — `duplicateChecklist`.
3. **Bulk-add tasks** (multiline paste → many tasks) — `createLineItems`.

Explicitly **kept from legacy:** active/inactive toggle, delete-protection when a
service is in use, auto "Default Checklist" on create, inline task add/edit/delete,
service_type suggestions, price-range display, URL-persisted selection.

Explicitly **dropped from legacy:** the middle `ServiceDetailView`→"Checklists"
two-step, the breadcrumb chrome, the `ChecklistFormModal` sessionStorage
draft-restore plumbing (the two-pane keeps everything inline; only the small
create/edit dialogs remain, which don't need draft persistence), and the
RLS-diagnostic debug panel.

## 10. Nav wiring

In `src/components/redesign/shell/nav-items.ts`, repoint the existing Services entry
from the legacy fallback to the new route, keeping `id: "services"` and `icon: Tag`:

```diff
- { id: "services", label: "Services", href: "/admin-dashboard?tab=services", icon: Tag },
+ { id: "services", label: "Services", href: "/app/admin-dashboard/services", icon: Tag },
```

The page sets `OperatorShell active="services"`, so the rail/mobile-nav highlight
the Services item.

## 11. Testing & verification

- **Unit:** `deriveServices.test.ts` covers filtering, sorting, price-range,
  checklist sort, and reorder reindex math.
- **Migration:** `npx supabase db reset` rebuilds the schema cleanly with `090`.
- **No new `/api` routes** → no integration test to add (services/checklists are
  direct Supabase calls inside hooks).
- **Manual / Playwright MCP** against `npm run dev` (redesign route group behind its
  feature flag): create/edit/duplicate/delete a service; create/edit/duplicate/
  delete a checklist; add (single + bulk) / edit / delete / reorder tasks; reorder
  checklists; active toggle; delete-protection path; read-only manager gating;
  desktop two-pane and mobile list↔detail.
- Pre-push gates per CLAUDE.md: `npm run test`, `npx tsc --noEmit`, `npm run lint`,
  then the Codex branch review, then push + PR to `master`.

## 12. Out of scope

- Booking-side consumption of checklists/tiers (the booking flow already attaches a
  checklist; unchanged here).
- Any change to the legacy `/admin-dashboard?tab=services` page (left intact behind
  the flag until cutover).
- Renaming "Checklist" globally (kept to avoid cross-screen terminology drift).
- Realtime re-architecture (we inherit the existing hook-level realtime).
