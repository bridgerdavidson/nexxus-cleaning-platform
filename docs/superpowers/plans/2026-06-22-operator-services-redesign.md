# Operator Services Screen (redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the operator Services management screen on the redesign foundation as a two-pane master–detail (list + full detail + all checklists together), eliminating the legacy detail→"Checklists" middle hop.

**Architecture:** Container/pure-View/pure-derive split mirroring the shipped Bookings and Customers redesign screens. A thin route wrapper mounts `OperatorShell` + `<OperatorServices/>`; `OperatorServices` is an outer permission gate that renders an inner `OperatorServicesData` (hooks, state, mutations, view-model construction). Reuses the existing `useServices`/`useService`/`useChecklists` hooks (which already carry TanStack Query + realtime). One small migration adds `checklists.position` so checklists (tiers) are drag-reorderable like tasks.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3 (redesign tokens), Supabase (RLS, no `/api` routes — direct client calls in hooks), TanStack Query v5, `@dnd-kit/{core,sortable,utilities}`, Vitest (unit), Playwright MCP (visual), redesign primitives under `src/components/ui/*`.

## Global Constraints

- **Worktree/branch:** all work in `.claude/worktrees/redesign-services` on branch `feat/redesign-operator-services` (off `master`). Absolute path prefix for every file below: `C:/Builds/NexxusCleaningSolutions/.claude/worktrees/redesign-services/`.
- **No legacy Services UI imported.** Build only from `src/components/ui/*` primitives and the new files here. Do not import `ServicesPage`, `ServiceCard`, `ServiceDetailView`, `ServiceFormModal`, `ChecklistFormModal`, etc.
- **Semantic tokens only.** Use `bg-background`/`text-foreground`/`border-border`/`bg-card`/`text-muted-foreground`/`bg-primary` etc. and redesign radii (`rounded-card`/`rounded-field`/`rounded-pill`) + `shadow-soft-*`. Never hardcode Tailwind palette colors (no `gray-100`, `red-600`).
- **No em dashes (`—`) in any user-facing copy** (labels, buttons, toasts, errors, empty states). For ranges use the word "to" or a "+" suffix, never a dash. (Code comments are exempt.)
- **Money/dates:** format with `toLocaleString('en-US', …)`; tabular numerals (`.tnum`) on prices. Prices: integers show 0 decimals, non-integers show 2 (`formatPrice` in Task 2).
- **Column-name traps** (`src/types/index.ts`): services use `duration_minutes` + `base_price`; the enum-like column is `service_type` (free-form text). `checklist_line_items` has `position` (nullable, nulls sort last) + `task`. `checklists` has `price_adder` + (after Task 1) `position`.
- **Org scoping is via RLS.** Reuse the hooks; do not write raw cross-org queries.
- **Gates before push (per CLAUDE.md):** `npm run test`, `npx tsc --noEmit`, `npm run lint`; if a migration changed, `npx supabase db reset`; then the Codex branch review; then push + PR to `master`.

---

### Task 1: Migration 090 — `checklists.position`

**Files:**
- Create: `supabase/migrations/090_checklist_position.sql`

**Interfaces:**
- Produces: a nullable `position int` column on `checklists`, backfilled deterministically per service (0-indexed by name). Consumed by Task 3's `reorderChecklists` and the hook's new sort.

- [ ] **Step 1: Write the migration**

```sql
-- 090_checklist_position.sql
-- Make checklists (service tiers) drag-reorderable, like checklist_line_items.
-- Nullable so the convention matches line items (NULL sorts last); backfilled
-- deterministically by name within each service so existing data has a stable order.

ALTER TABLE checklists ADD COLUMN IF NOT EXISTS position integer;

WITH ordered AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY service_type_id ORDER BY name ASC, created_at ASC) - 1 AS pos
  FROM checklists
)
UPDATE checklists c
SET position = ordered.pos
FROM ordered
WHERE c.id = ordered.id
  AND c.position IS NULL;

COMMENT ON COLUMN checklists.position IS
  '0-indexed display order of this checklist (tier) within its service; NULL sorts last (matches checklist_line_items.position).';
```

`checklists` already has `REPLICA IDENTITY FULL` and is in the `supabase_realtime` publication (migration 081), so no realtime wiring is needed here.

- [ ] **Step 2: Verify the schema rebuilds cleanly**

Run (requires Docker Desktop + local stack): `npx supabase db reset`
Expected: completes without error; all migrations through `090` apply. If Docker is unavailable in this environment, instead validate the SQL by inspection (it is idempotent: `ADD COLUMN IF NOT EXISTS` + a guarded backfill) and note that `db reset` must be run on a machine with Docker before the PR is opened.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/090_checklist_position.sql
git commit -m "feat(services): migration 090 adds checklists.position for tier reordering"
```

---

### Task 2: View-model types + pure derive helpers (+ unit tests)

This is the testable core (the only part with unit tests, matching how Bookings/Customers are tested). TDD it.

**Files:**
- Create: `src/components/redesign/services/services-types.ts`
- Create: `src/components/redesign/services/deriveServices.ts`
- Test: `src/components/redesign/services/deriveServices.test.ts`

**Interfaces:**
- Produces (consumed by every later UI task):
  - Types: `ServiceSort = "name" | "recent" | "price"`, `ServiceStatusFilter = "active" | "all" | "inactive"`, const arrays `SERVICE_SORTS`, `SERVICE_STATUS_FILTERS`, and VMs `ServiceRowVM`, `ServiceDetailVM`, `TaskVM`, `ChecklistVM`.
  - Pure fns: `formatPrice(n)`, `rowPriceLabel(base, maxAdder)`, `priceRangeLabel(base, maxAdder)`, `priceAdderLabel(adder)`, `formatDuration(min)`, `serviceTypeLabel(raw)`, `filterServices(list, {search,status})`, `sortServices(list, sort)`, `sortChecklists(list)`.

- [ ] **Step 1: Write `services-types.ts`**

```ts
// View-model types for the redesigned Operator Services screen. The View and its
// sub-components render the same from real hook data (OperatorServices) or mocks.

export type ServiceSort = "name" | "recent" | "price";
export type ServiceStatusFilter = "active" | "all" | "inactive";

export const SERVICE_SORTS: { id: ServiceSort; label: string }[] = [
  { id: "name", label: "Name (A to Z)" },
  { id: "recent", label: "Recently updated" },
  { id: "price", label: "Price (low to high)" },
];

export const SERVICE_STATUS_FILTERS: { id: ServiceStatusFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "inactive", label: "Inactive" },
];

/** One row in the left list. */
export type ServiceRowVM = {
  id: string;
  name: string;
  priceLabel: string; // "$120" or "$120+" when the service has paid add-on tiers
  durationLabel: string; // "90m" / "1h 30m"
  serviceTypeLabel: string; // "Move Out"
  isActive: boolean;
};

/** Header of the right detail pane. */
export type ServiceDetailVM = {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  basePriceLabel: string; // "$120"
  durationMinutes: number;
  durationLabel: string;
  serviceType: string; // raw, e.g. "move_out"
  serviceTypeLabel: string;
  isActive: boolean;
  priceRangeLabel: string; // "$120" or "$120 to $160"
};

/** One task inside a checklist. */
export type TaskVM = { id: string; task: string };

/** One checklist (tier) of a service. */
export type ChecklistVM = {
  id: string;
  name: string;
  priceAdder: number;
  priceAdderLabel: string; // "+$20" or "+$0"
  tasks: TaskVM[];
};
```

- [ ] **Step 2: Write the failing tests** in `deriveServices.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  formatPrice,
  rowPriceLabel,
  priceRangeLabel,
  priceAdderLabel,
  formatDuration,
  serviceTypeLabel,
  filterServices,
  sortServices,
  sortChecklists,
} from "./deriveServices";

const svc = (over: Partial<{
  id: string; name: string; description: string | null; base_price: number;
  duration_minutes: number; service_type: string; is_active: boolean; updated_at: string;
}> = {}) => ({
  id: "1", name: "Standard Clean", description: "A clean", base_price: 120,
  duration_minutes: 90, service_type: "regular", is_active: true,
  updated_at: "2026-06-01T00:00:00Z", ...over,
});

describe("formatPrice", () => {
  it("drops decimals for integers", () => expect(formatPrice(120)).toBe("$120"));
  it("keeps two decimals for non-integers", () => expect(formatPrice(120.5)).toBe("$120.50"));
  it("adds thousands separators", () => expect(formatPrice(1200)).toBe("$1,200"));
});

describe("rowPriceLabel / priceRangeLabel", () => {
  it("shows base alone with no add-on", () => {
    expect(rowPriceLabel(120, 0)).toBe("$120");
    expect(priceRangeLabel(120, 0)).toBe("$120");
  });
  it("shows a + in the row and a 'to' range in detail when add-ons exist", () => {
    expect(rowPriceLabel(120, 40)).toBe("$120+");
    expect(priceRangeLabel(120, 40)).toBe("$120 to $160");
  });
  it("never uses a dash in the range", () => {
    expect(priceRangeLabel(120, 40)).not.toContain("-");
    expect(priceRangeLabel(120, 40)).not.toContain("—");
  });
});

describe("priceAdderLabel", () => {
  it("formats positive adders", () => expect(priceAdderLabel(20)).toBe("+$20"));
  it("formats a zero adder", () => expect(priceAdderLabel(0)).toBe("+$0"));
});

describe("formatDuration", () => {
  it("minutes under an hour", () => expect(formatDuration(45)).toBe("45m"));
  it("whole hours", () => expect(formatDuration(120)).toBe("2h"));
  it("hours and minutes", () => expect(formatDuration(90)).toBe("1h 30m"));
});

describe("serviceTypeLabel", () => {
  it("title-cases and de-underscores", () => {
    expect(serviceTypeLabel("move_out")).toBe("Move Out");
    expect(serviceTypeLabel("regular")).toBe("Regular");
  });
});

describe("filterServices", () => {
  const list = [
    svc({ id: "a", name: "Standard Clean", is_active: true, service_type: "regular" }),
    svc({ id: "b", name: "Deep Clean", is_active: false, service_type: "deep" }),
  ];
  it("filters by status active/inactive/all", () => {
    expect(filterServices(list, { search: "", status: "active" }).map((s) => s.id)).toEqual(["a"]);
    expect(filterServices(list, { search: "", status: "inactive" }).map((s) => s.id)).toEqual(["b"]);
    expect(filterServices(list, { search: "", status: "all" }).map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("free-text matches name/type/description", () => {
    expect(filterServices(list, { search: "deep", status: "all" }).map((s) => s.id)).toEqual(["b"]);
  });
  it("returns a new array", () => {
    expect(filterServices(list, { search: "", status: "all" })).not.toBe(list);
  });
});

describe("sortServices", () => {
  const list = [
    svc({ id: "a", name: "Bravo", base_price: 200, updated_at: "2026-06-01T00:00:00Z" }),
    svc({ id: "b", name: "Alpha", base_price: 100, updated_at: "2026-06-10T00:00:00Z" }),
  ];
  it("name A to Z", () => expect(sortServices(list, "name").map((s) => s.id)).toEqual(["b", "a"]));
  it("recent = newest updated first", () => expect(sortServices(list, "recent").map((s) => s.id)).toEqual(["b", "a"]));
  it("price low to high", () => expect(sortServices(list, "price").map((s) => s.id)).toEqual(["b", "a"]));
});

describe("sortChecklists", () => {
  it("orders by position (nulls last) then name", () => {
    const cls = [
      { id: "1", name: "Zeta", position: null },
      { id: "2", name: "Beta", position: 1 },
      { id: "3", name: "Alpha", position: 0 },
    ];
    expect(sortChecklists(cls).map((c) => c.id)).toEqual(["3", "2", "1"]);
  });
});
```

- [ ] **Step 3: Run the tests, verify they fail**

Run: `npm run test:unit -- deriveServices`
Expected: FAIL (module/exports not found).

- [ ] **Step 4: Write `deriveServices.ts`**

```ts
import type { ServiceSort, ServiceStatusFilter } from "./services-types";

// Pure formatting + filter/sort for the Operator Services screen. No React or
// data-layer dependency, so it is unit-tested in isolation. Generic over the
// record shape so the container gets its concrete arrays back unchanged.

export function formatPrice(n: number): string {
  const v = Number(n) || 0;
  const digits = Number.isInteger(v) ? 0 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

/** Compact list label: base, or "base+" when paid add-on tiers exist. */
export function rowPriceLabel(base: number, maxAdder: number): string {
  return maxAdder > 0 ? `${formatPrice(base)}+` : formatPrice(base);
}

/** Detail label: base, or "base to (base+max)". Never a dash (CLAUDE.md copy rule). */
export function priceRangeLabel(base: number, maxAdder: number): string {
  return maxAdder > 0 ? `${formatPrice(base)} to ${formatPrice(base + maxAdder)}` : formatPrice(base);
}

export function priceAdderLabel(adder: number): string {
  return `+${formatPrice(Number(adder) || 0)}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function serviceTypeLabel(raw: string): string {
  return (raw ?? "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

type ServiceLike = {
  name: string;
  description?: string | null;
  base_price: number;
  service_type: string;
  is_active: boolean;
  updated_at: string;
};

export function filterServices<T extends ServiceLike>(
  list: T[],
  opts: { search: string; status: ServiceStatusFilter },
): T[] {
  const q = opts.search.trim().toLowerCase();
  return list.filter((s) => {
    if (opts.status === "active" && !s.is_active) return false;
    if (opts.status === "inactive" && s.is_active) return false;
    if (!q) return true;
    const hay = [s.name, s.service_type, s.description ?? ""].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function sortServices<T extends ServiceLike>(list: T[], sort: ServiceSort): T[] {
  const copy = [...list];
  switch (sort) {
    case "recent":
      copy.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      break;
    case "price":
      copy.sort((a, b) => (a.base_price ?? 0) - (b.base_price ?? 0));
      break;
    case "name":
    default:
      copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
  }
  return copy;
}

type ChecklistLike = { name: string; position?: number | null };

/** position asc (nulls last) then name. Returns a NEW array. */
export function sortChecklists<T extends ChecklistLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ap = a.position ?? null;
    const bp = b.position ?? null;
    if (ap === null && bp === null) return a.name.localeCompare(b.name);
    if (ap === null) return 1;
    if (bp === null) return -1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `npm run test:unit -- deriveServices`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add src/components/redesign/services/services-types.ts src/components/redesign/services/deriveServices.ts src/components/redesign/services/deriveServices.test.ts
git commit -m "feat(services): view-model types + pure derive helpers with tests"
```

---

### Task 3: `useChecklists` additions — reorder/duplicate/bulk + position sort

**Files:**
- Modify: `src/hooks/useChecklists.ts`
- Modify: `src/types/index.ts` (add `position` to the `Checklist` interface)

**Interfaces:**
- Consumes: existing `createLineItem`, `reorderLineItems` patterns in the same file.
- Produces (used by Task 7/8 container handlers):
  - `reorderChecklists(serviceTypeId: string, orderedIds: string[]): Promise<{ success: boolean; error?: string }>`
  - `duplicateChecklist(checklistId: string): Promise<{ success: boolean; data?: ChecklistWithItems; error?: string }>`
  - `createLineItems(checklistId: string, tasks: string[]): Promise<{ success: boolean; data?: ChecklistLineItem[]; error?: string }>`
  - The hook now sorts checklists by `position` (nulls last) then `name`.

- [ ] **Step 1: Add `position` to the `Checklist` type**

In `src/types/index.ts`, find the `Checklist` interface (fields `id`, `name`, `service_type_id`, `price_adder`, `created_at`, `updated_at`) and add:

```ts
  position: number | null; // 0-indexed tier order; NULL sorts last (migration 090)
```

- [ ] **Step 2: Sort checklists by position in the hook query**

In `useChecklists.ts`, change the `.order('name', { ascending: true })` query to fetch unordered and sort in JS (so nulls-last + name tiebreak matches `sortChecklists`). Replace the `queryFn`'s post-fetch block so the top-level checklists are sorted:

```ts
      const checklistsWithItems = (data || []) as ChecklistWithItems[];
      checklistsWithItems.sort((a, b) => {
        const ap = a.position ?? null;
        const bp = b.position ?? null;
        if (ap === null && bp === null) return a.name.localeCompare(b.name);
        if (ap === null) return 1;
        if (bp === null) return -1;
        if (ap !== bp) return ap - bp;
        return a.name.localeCompare(b.name);
      });
      checklistsWithItems.forEach((checklist) => {
        if (checklist.checklist_line_items) {
          checklist.checklist_line_items.sort((a, b) => {
            if (a.position === null && b.position === null) {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            }
            if (a.position === null) return 1;
            if (b.position === null) return -1;
            if (a.position !== b.position) return a.position - b.position;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });
        }
      });
      return checklistsWithItems;
```

Also remove `.order('name', { ascending: true })` from the `.select(...).eq(...)` chain (the JS sort replaces it).

Also update `applyChecklistAdded` so an optimistically-added checklist keeps the same ordering (append then re-sort by position-nulls-last then name):

```ts
  const applyChecklistAdded = useCallback(
    (checklist: ChecklistWithItems) => {
      updateCache(prev =>
        [...prev, checklist].sort((a, b) => {
          const ap = a.position ?? null;
          const bp = b.position ?? null;
          if (ap === null && bp === null) return a.name.localeCompare(b.name);
          if (ap === null) return 1;
          if (bp === null) return -1;
          if (ap !== bp) return ap - bp;
          return a.name.localeCompare(b.name);
        })
      );
    },
    [updateCache]
  );
```

- [ ] **Step 3: Add `reorderChecklists`** (after `reorderLineItems`)

```ts
/**
 * Reorder checklists (tiers) within a service by writing 0-indexed positions.
 * Sequential updates avoid request storms, matching reorderLineItems.
 */
export async function reorderChecklists(
  serviceTypeId: string,
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    for (const [index, id] of orderedIds.entries()) {
      const { error } = await supabase
        .from('checklists')
        .update({ position: index })
        .eq('id', id)
        .eq('service_type_id', serviceTypeId); // ensure the checklist belongs to this service
      if (error) throw error;
    }
    return { success: true };
  } catch (err) {
    console.error('Error reordering checklists:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to reorder checklists' };
  }
}
```

- [ ] **Step 4: Add `createLineItems` (bulk)** (after `createLineItem`)

```ts
/**
 * Bulk-create line items from pasted text. Each non-blank line becomes one task,
 * appended after existing items (position left NULL so they sort last by created_at).
 */
export async function createLineItems(
  checklistId: string,
  tasks: string[]
): Promise<{ success: boolean; data?: ChecklistLineItem[]; error?: string }> {
  try {
    const rows = tasks
      .map((t) => t.trim())
      .filter(Boolean)
      .map((task) => ({ checklist_id: checklistId, task }));
    if (rows.length === 0) return { success: false, error: 'No tasks to add' };

    const { data, error } = await supabase
      .from('checklist_line_items')
      .insert(rows)
      .select();
    if (error) throw error;
    return { success: true, data: (data ?? []) as ChecklistLineItem[] };
  } catch (err) {
    console.error('Error bulk-creating line items:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to add tasks' };
  }
}
```

- [ ] **Step 5: Add `duplicateChecklist`** (after `deleteChecklist`)

```ts
/**
 * Clone a checklist (tier) within the same service, including all its line items
 * in order. The copy is named "<name> (copy)" and appended (position = NULL so it
 * sorts last until the user reorders).
 */
export async function duplicateChecklist(
  checklistId: string
): Promise<{ success: boolean; data?: ChecklistWithItems; error?: string }> {
  try {
    const { data: source, error: srcError } = await supabase
      .from('checklists')
      .select('*, checklist_line_items (*)')
      .eq('id', checklistId)
      .single();
    if (srcError) throw srcError;

    const src = source as ChecklistWithItems;
    const { data: created, error: createError } = await supabase
      .from('checklists')
      .insert({
        service_type_id: src.service_type_id,
        name: `${src.name} (copy)`,
        price_adder: src.price_adder,
        position: null,
      })
      .select()
      .single();
    if (createError) throw createError;

    const items = [...(src.checklist_line_items ?? [])].sort((a, b) => {
      if (a.position === null && b.position === null) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      return (a.position ?? 0) - (b.position ?? 0);
    });

    let clonedItems: ChecklistLineItem[] = [];
    if (items.length > 0) {
      const { data: inserted, error: itemsError } = await supabase
        .from('checklist_line_items')
        .insert(items.map((it, idx) => ({ checklist_id: created.id, task: it.task, position: idx })))
        .select();
      if (itemsError) throw itemsError;
      clonedItems = (inserted ?? []) as ChecklistLineItem[];
    }

    return { success: true, data: { ...(created as Checklist), checklist_line_items: clonedItems } };
  } catch (err) {
    console.error('Error duplicating checklist:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to duplicate checklist' };
  }
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors referencing `useChecklists.ts` or `src/types/index.ts` (pre-existing repo errors may still print).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useChecklists.ts src/types/index.ts
git commit -m "feat(services): checklist reorder/duplicate/bulk-add + position sort"
```

---

### Task 4: `useServices.duplicateService` (with trigger gotcha)

**Files:**
- Modify: `src/hooks/useServices.ts`

**Interfaces:**
- Consumes: existing `createService` shape, `supabase` client.
- Produces: `duplicateService(organizationId: string, serviceId: string): Promise<{ success: boolean; data?: ServiceType; error?: string }>` (used by Task 11 container).

- [ ] **Step 1: Add `duplicateService`** (after `deleteService`)

```ts
// Duplicate a service, cloning all of its checklists + line items.
// GOTCHA: inserting a service_type fires the create_default_checklist_for_service
// trigger, which seeds a "Default Checklist". We delete that auto-seeded checklist
// before copying the source's real checklists, so the clone is an exact copy.
export async function duplicateService(
  organizationId: string,
  serviceId: string
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  try {
    const { data: source, error: srcError } = await supabase
      .from('service_types')
      .select('*')
      .eq('id', serviceId)
      .eq('organization_id', organizationId)
      .single();
    if (srcError) throw srcError;
    const src = source as ServiceType;

    // 1. Clone the service row (fires the default-checklist trigger).
    const { data: created, error: createError } = await supabase
      .from('service_types')
      .insert({
        organization_id: organizationId,
        name: `${src.name} (copy)`,
        description: src.description,
        base_price: src.base_price,
        duration_minutes: src.duration_minutes,
        service_type: src.service_type,
        is_active: src.is_active,
      })
      .select()
      .single();
    if (createError) throw createError;
    const newService = created as ServiceType;

    // 2. Remove the trigger-seeded "Default Checklist" so we copy only the source's.
    const { error: delError } = await supabase
      .from('checklists')
      .delete()
      .eq('service_type_id', newService.id);
    if (delError) throw delError;

    // 3. Copy the source's checklists + their line items, preserving order.
    const { data: srcChecklists, error: clError } = await supabase
      .from('checklists')
      .select('*, checklist_line_items (*)')
      .eq('service_type_id', serviceId);
    if (clError) throw clError;

    for (const cl of (srcChecklists ?? []) as ChecklistWithItemsRow[]) {
      const { data: newCl, error: insClError } = await supabase
        .from('checklists')
        .insert({
          service_type_id: newService.id,
          name: cl.name,
          price_adder: cl.price_adder,
          position: cl.position,
        })
        .select()
        .single();
      if (insClError) throw insClError;

      const items = [...(cl.checklist_line_items ?? [])].sort(
        (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9)
      );
      if (items.length > 0) {
        const { error: insItemsError } = await supabase
          .from('checklist_line_items')
          .insert(items.map((it, idx) => ({ checklist_id: newCl.id, task: it.task, position: idx })));
        if (insItemsError) throw insItemsError;
      }
    }

    return { success: true, data: newService };
  } catch (err) {
    console.error('Error duplicating service:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to duplicate service' };
  }
}

// Local row shape for the duplicate query (checklists + nested line items).
type ChecklistWithItemsRow = {
  id: string;
  name: string;
  price_adder: number;
  position: number | null;
  checklist_line_items: { id: string; task: string; position: number | null }[] | null;
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors in `useServices.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useServices.ts
git commit -m "feat(services): duplicateService clones checklists + tasks (handles default-checklist trigger)"
```

---

### Task 5: `ServicesList` (left pane, pure)

**Files:**
- Create: `src/components/redesign/services/ServicesList.tsx`

**Interfaces:**
- Consumes: `ServiceRowVM` (Task 2).
- Produces: `ServicesList` props `{ rows: ServiceRowVM[]; selectedId: string | null; onSelect: (id: string) => void }`.

- [ ] **Step 1: Implement the list**

A pure scrollable list of selectable rows. Each row is a `button` (full-width, left-aligned). Use semantic tokens; selected row gets `bg-primary/10 text-foreground` with a `border-l-2 border-primary`; inactive services render at reduced emphasis (`opacity-60`). Tabular numerals on the price chip.

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { ServiceRowVM } from "./services-types";

export function ServicesList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ServiceRowVM[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => {
        const selected = r.id === selectedId;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "w-full rounded-field border border-transparent px-3 py-2.5 text-left transition-colors",
                "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "border-border bg-primary/10",
                !r.isActive && "opacity-60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-foreground">{r.name}</span>
                <span className="tnum shrink-0 text-sm font-medium text-muted-foreground">{r.priceLabel}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{r.serviceTypeLabel}</span>
                <span aria-hidden>·</span>
                <span>{r.durationLabel}</span>
                {!r.isActive && <span className="ml-auto rounded-pill bg-muted px-2 py-0.5">Inactive</span>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

Note: `cn` is the repo's classname helper at `@/lib/utils`. If it does not exist, check how other `src/components/ui/*` files import it and match that.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors in `ServicesList.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/services/ServicesList.tsx
git commit -m "feat(services): left-pane services list (pure)"
```

---

### Task 6: `SortableTask` + `ChecklistCard` (one tier, draggable tasks, add-task incl. bulk)

**Files:**
- Create: `src/components/redesign/services/SortableTask.tsx`
- Create: `src/components/redesign/services/ChecklistCard.tsx`

**Interfaces:**
- Consumes: `TaskVM`, `ChecklistVM` (Task 2); `@dnd-kit/sortable`, `@dnd-kit/core`, `@dnd-kit/utilities`; `arrayMove`.
- Produces:
  - `SortableTask` props `{ task: TaskVM; canManage: boolean; onSave: (id: string, task: string) => void; onDelete: (id: string) => void }` (owns its own edit-mode + input state locally).
  - `ChecklistCard` props (callbacks lifted to the container, ephemeral UI state local):
    ```ts
    {
      checklist: ChecklistVM;
      canManage: boolean;
      handleProps?: { attributes: any; listeners: any }; // checklist-level drag handle from ChecklistsEditor
      onAddTasks: (checklistId: string, raw: string) => void; // raw may be multiline => bulk
      onSaveTask: (taskId: string, task: string) => void;
      onDeleteTask: (taskId: string) => void;
      onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
      onEditChecklist: (checklistId: string) => void;
      onDuplicateChecklist: (checklistId: string) => void;
      onDeleteChecklist: (checklistId: string) => void;
    }
    ```

- [ ] **Step 1: Implement `SortableTask`**

A sortable row: drag handle (`GripVertical`, only when `canManage`), task text or an inline edit input (toggled by local `editing` state), and hover-revealed `Pencil`/`Trash2` icon-buttons. Enter/blur saves, Escape cancels, empty rejected. Use `useSortable({ id: task.id })`.

```tsx
"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TaskVM } from "./services-types";

export function SortableTask({
  task,
  canManage,
  onSave,
  onDelete,
}: {
  task: TaskVM;
  canManage: boolean;
  onSave: (id: string, task: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.task);

  const style = { transform: CSS.Transform.toString(transform), transition };

  const commit = () => {
    const t = text.trim();
    if (!t) return;
    onSave(task.id, t);
    setEditing(false);
  };
  const cancel = () => {
    setText(task.task);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-field px-2 py-1.5 hover:bg-muted/60",
        isDragging && "opacity-50",
      )}
    >
      {canManage && (
        <button
          type="button"
          className="cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder task"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {editing ? (
        <>
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            className="h-9"
          />
          <Button size="icon" variant="ghost" aria-label="Save task" onClick={commit}>
            <Check className="size-4 text-positive-700" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Cancel" onClick={cancel}>
            <X className="size-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-foreground">{task.task}</span>
          {canManage && (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <Button size="icon" variant="ghost" aria-label="Edit task" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Delete task" onClick={() => onDelete(task.id)}>
                <Trash2 className="size-4 text-critical-700" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `ChecklistCard`**

A `Card` whose header carries the checklist-level drag handle (`handleProps` from the parent), the name, a `+$adder` badge, and `Edit`/`Duplicate`/`Delete` actions (via a `DropdownMenu` or three icon-buttons). The body wraps the tasks in a task-level `DndContext`/`SortableContext` and renders `SortableTask` rows, then an add-task affordance. The add-task input supports multiline paste → `onAddTasks(checklist.id, raw)`.

```tsx
"use client";

import { useState } from "react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { GripVertical, Plus, Pencil, Copy, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { SortableTask } from "./SortableTask";
import type { ChecklistVM } from "./services-types";

export function ChecklistCard({
  checklist,
  canManage,
  handleProps,
  onAddTasks,
  onSaveTask,
  onDeleteTask,
  onReorderTasks,
  onEditChecklist,
  onDuplicateChecklist,
  onDeleteChecklist,
}: {
  checklist: ChecklistVM;
  canManage: boolean;
  handleProps?: { attributes: Record<string, unknown>; listeners: Record<string, unknown> | undefined };
  onAddTasks: (checklistId: string, raw: string) => void;
  onSaveTask: (taskId: string, task: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
  onEditChecklist: (checklistId: string) => void;
  onDuplicateChecklist: (checklistId: string) => void;
  onDeleteChecklist: (checklistId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = checklist.tasks.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string));
    onReorderTasks(checklist.id, next);
  };

  const submitAdd = () => {
    if (draft.trim()) onAddTasks(checklist.id, draft);
    setDraft("");
    setAdding(false);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {canManage && (
          <button
            type="button"
            className="cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
            aria-label="Drag to reorder checklist"
            {...(handleProps?.attributes ?? {})}
            {...(handleProps?.listeners ?? {})}
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <span className="font-bold text-foreground">{checklist.name}</span>
        <Badge variant="secondary" className="tnum">{checklist.priceAdderLabel}</Badge>
        {canManage && (
          <div className="ml-auto flex items-center gap-0.5">
            <Button size="icon" variant="ghost" aria-label="Edit checklist" onClick={() => onEditChecklist(checklist.id)}>
              <Pencil className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Duplicate checklist" onClick={() => onDuplicateChecklist(checklist.id)}>
              <Copy className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete checklist" onClick={() => onDeleteChecklist(checklist.id)}>
              <Trash2 className="size-4 text-critical-700" />
            </Button>
          </div>
        )}
      </div>

      <div className="p-2">
        {checklist.tasks.length === 0 && !adding && (
          <p className="px-2 py-3 text-sm text-muted-foreground">No tasks yet. Add the first one.</p>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={checklist.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {checklist.tasks.map((t) => (
              <SortableTask key={t.id} task={t} canManage={canManage} onSave={onSaveTask} onDelete={onDeleteTask} />
            ))}
          </SortableContext>
        </DndContext>

        {canManage && (adding ? (
          <div className="flex flex-col gap-2 px-2 py-2">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAdd();
                if (e.key === "Escape") { setDraft(""); setAdding(false); }
              }}
              placeholder="Add a task. Paste multiple lines to add several at once."
              rows={2}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={submitAdd}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(""); setAdding(false); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add task
          </Button>
        ))}
      </div>
    </Card>
  );
}
```

Note: confirm `Textarea` is exported from `@/components/ui/textarea` and `Badge` `variant="secondary"` exists (Task 2 of the foundation listed both). The `status` color classes (`text-positive-700`, `text-critical-700`) are defined in the redesign token ramps.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors in the two new files. (dnd-kit `active.id` is `string | number`; the `as string` casts handle it.)

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/services/SortableTask.tsx src/components/redesign/services/ChecklistCard.tsx
git commit -m "feat(services): checklist card with draggable tasks + bulk add-task"
```

---

### Task 7: `ChecklistsEditor` (draggable list of checklist cards + add-checklist)

**Files:**
- Create: `src/components/redesign/services/ChecklistsEditor.tsx`

**Interfaces:**
- Consumes: `ChecklistVM` (Task 2), `ChecklistCard` (Task 6), dnd-kit.
- Produces: `ChecklistsEditor` props:
  ```ts
  {
    checklists: ChecklistVM[];
    canManage: boolean;
    onReorderChecklists: (orderedIds: string[]) => void;
    onAddChecklist: () => void;
    // forwarded to each ChecklistCard:
    onAddTasks: (checklistId: string, raw: string) => void;
    onSaveTask: (taskId: string, task: string) => void;
    onDeleteTask: (taskId: string) => void;
    onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
    onEditChecklist: (checklistId: string) => void;
    onDuplicateChecklist: (checklistId: string) => void;
    onDeleteChecklist: (checklistId: string) => void;
  }
  ```

- [ ] **Step 1: Implement the editor**

A checklist-level `DndContext`/`SortableContext`. Each checklist is wrapped in a `SortableChecklist` that calls `useSortable({ id })` and forwards `{ attributes, listeners }` as `handleProps` to `ChecklistCard` (so only the header grip starts a drag, not the whole card). A section header with `+ Add checklist`.

```tsx
"use client";

import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  arrayMove, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChecklistCard } from "./ChecklistCard";
import type { ChecklistVM } from "./services-types";

type CardHandlers = {
  onAddTasks: (checklistId: string, raw: string) => void;
  onSaveTask: (taskId: string, task: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
  onEditChecklist: (checklistId: string) => void;
  onDuplicateChecklist: (checklistId: string) => void;
  onDeleteChecklist: (checklistId: string) => void;
};

function SortableChecklist({
  checklist, canManage, handlers,
}: { checklist: ChecklistVM; canManage: boolean; handlers: CardHandlers }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: checklist.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <ChecklistCard
        checklist={checklist}
        canManage={canManage}
        handleProps={{ attributes, listeners }}
        {...handlers}
      />
    </div>
  );
}

export function ChecklistsEditor({
  checklists, canManage, onReorderChecklists, onAddChecklist, ...handlers
}: {
  checklists: ChecklistVM[];
  canManage: boolean;
  onReorderChecklists: (orderedIds: string[]) => void;
  onAddChecklist: () => void;
} & CardHandlers) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = checklists.map((c) => c.id);
    onReorderChecklists(arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string)));
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.04em] text-muted-foreground">Checklists</h3>
        {canManage && (
          <Button size="sm" variant="outline" onClick={onAddChecklist}>
            <Plus className="size-4" /> Add checklist
          </Button>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={checklists.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {checklists.map((c) => (
              <SortableChecklist key={c.id} checklist={c} canManage={canManage} handlers={handlers} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors in `ChecklistsEditor.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/services/ChecklistsEditor.tsx
git commit -m "feat(services): draggable checklists editor with add-checklist"
```

---

### Task 8: `ServiceDetailPane` (right pane header + actions + checklists)

**Files:**
- Create: `src/components/redesign/services/ServiceDetailPane.tsx`

**Interfaces:**
- Consumes: `ServiceDetailVM`, `ChecklistVM` (Task 2), `ChecklistsEditor` (Task 7), `DropdownMenu` + `Switch` + `Badge` primitives.
- Produces: `ServiceDetailPane` props:
  ```ts
  {
    detail: ServiceDetailVM | null;
    checklists: ChecklistVM[];
    checklistsLoading: boolean;
    canManage: boolean;
    onBack: () => void;          // mobile: clear selection
    onEdit: () => void;
    onToggleActive: (next: boolean) => void;
    onDuplicateService: () => void;
    onDeleteService: () => void;
    // checklist callbacks forwarded to ChecklistsEditor:
    onReorderChecklists: (orderedIds: string[]) => void;
    onAddChecklist: () => void;
    onAddTasks: (checklistId: string, raw: string) => void;
    onSaveTask: (taskId: string, task: string) => void;
    onDeleteTask: (taskId: string) => void;
    onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
    onEditChecklist: (checklistId: string) => void;
    onDuplicateChecklist: (checklistId: string) => void;
    onDeleteChecklist: (checklistId: string) => void;
  }
  ```

- [ ] **Step 1: Implement the pane**

Header: a mobile-only `‹ Back` button (`lg:hidden`), the service name + a status `Badge` (`positive` when active, `secondary` "Inactive" otherwise), a metadata line (`priceRangeLabel · durationLabel · serviceTypeLabel`, tabular numerals on price), and an actions cluster: `Edit` button, an active/inactive control (a `Switch` with a label, gated by `canManage`), and a `⋯` `DropdownMenu` (`Duplicate service`, `Delete` destructive). Below: the description (if any), then `<ChecklistsEditor/>`. When `checklistsLoading`, show two `Skeleton` cards. When `detail` is null, render a quiet "Select a service to see its details." placeholder.

Reference the redesign `DropdownMenu` (`@/components/ui/dropdown-menu`) and `Switch` (`@/components/ui/switch`) exports for exact sub-component names (Trigger/Content/Item etc.). Keep all copy em-dash-free.

```tsx
"use client";

import { ChevronLeft, MoreHorizontal, Pencil, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChecklistsEditor } from "./ChecklistsEditor";
import type { ServiceDetailVM, ChecklistVM } from "./services-types";

export function ServiceDetailPane(props: {
  detail: ServiceDetailVM | null;
  checklists: ChecklistVM[];
  checklistsLoading: boolean;
  canManage: boolean;
  onBack: () => void;
  onEdit: () => void;
  onToggleActive: (next: boolean) => void;
  onDuplicateService: () => void;
  onDeleteService: () => void;
  onReorderChecklists: (orderedIds: string[]) => void;
  onAddChecklist: () => void;
  onAddTasks: (checklistId: string, raw: string) => void;
  onSaveTask: (taskId: string, task: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
  onEditChecklist: (checklistId: string) => void;
  onDuplicateChecklist: (checklistId: string) => void;
  onDeleteChecklist: (checklistId: string) => void;
}) {
  const { detail, canManage } = props;
  if (!detail) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">Select a service to see its details.</div>;
  }
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="lg:hidden -ml-2 text-muted-foreground" onClick={props.onBack}>
          <ChevronLeft className="size-4" /> All services
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-foreground">{detail.name}</h2>
              <Badge variant={detail.isActive ? "positive" : "secondary"}>
                {detail.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="tnum text-sm text-muted-foreground">
              {detail.priceRangeLabel} · {detail.durationLabel} · {detail.serviceTypeLabel}
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={detail.isActive} onCheckedChange={props.onToggleActive} aria-label="Active" />
                Active
              </label>
              <Button variant="outline" size="sm" onClick={props.onEdit}>
                <Pencil className="size-4" /> Edit
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <MoreHorizontal className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={props.onDuplicateService}>
                    <Copy className="size-4" /> Duplicate service
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={props.onDeleteService} className="text-critical-700">
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {detail.description && <p className="text-sm text-foreground/80">{detail.description}</p>}
      </div>

      {props.checklistsLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
        </div>
      ) : (
        <ChecklistsEditor
          checklists={props.checklists}
          canManage={canManage}
          onReorderChecklists={props.onReorderChecklists}
          onAddChecklist={props.onAddChecklist}
          onAddTasks={props.onAddTasks}
          onSaveTask={props.onSaveTask}
          onDeleteTask={props.onDeleteTask}
          onReorderTasks={props.onReorderTasks}
          onEditChecklist={props.onEditChecklist}
          onDuplicateChecklist={props.onDuplicateChecklist}
          onDeleteChecklist={props.onDeleteChecklist}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` (no NEW errors). Fix any `DropdownMenu`/`Switch` sub-component name mismatches by checking the actual primitive exports.

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/services/ServiceDetailPane.tsx
git commit -m "feat(services): service detail pane (header, actions, checklists)"
```

---

### Task 9: Dialogs — service form, checklist form, delete confirms

**Files:**
- Create: `src/components/redesign/services/ServiceFormDialog.tsx`
- Create: `src/components/redesign/services/ChecklistFormDialog.tsx`
- Create: `src/components/redesign/services/DeleteServiceDialog.tsx`
- Create: `src/components/redesign/services/DeleteChecklistDialog.tsx`

**Interfaces:**
- Produces:
  - `ServiceFormDialog` props `{ open; onOpenChange; busy; initial?: ServiceFormValues | null; onSubmit: (v: ServiceFormValues) => void }` where `ServiceFormValues = { name: string; description: string; base_price: number; duration_minutes: number; service_type: string; is_active: boolean }`. `initial == null` => create mode (title "New service"), else edit.
  - `ChecklistFormDialog` props `{ open; onOpenChange; busy; initial?: { name: string; price_adder: number } | null; onSubmit: (v: { name: string; price_adder: number }) => void }`.
  - `DeleteServiceDialog` props `{ open; onOpenChange; busy; serviceName: string; canDelete: boolean; appointmentCount: number; seriesCount: number; onConfirm: () => void }`.
  - `DeleteChecklistDialog` props `{ open; onOpenChange; busy; checklistName: string; itemCount: number; onConfirm: () => void }`.

- [ ] **Step 1: Implement `ServiceFormDialog`**

Use `Dialog` (`@/components/ui/dialog`) + `FormField`/`Label` + `Input`/`Textarea` + a `Switch`. Fields: name (required), description (textarea), base_price (number, min 0, step 0.01), duration_minutes (number, min 1, step 1), service_type (Input with a `datalist` of suggestions `regular, deep, move_out, move_in, custom, one_time, recurring, seasonal, office, commercial`), is_active (Switch). Normalize service_type to lowercase + spaces→underscores on submit. Disable the submit button while `busy` or when name/price/duration are invalid. Title: `initial ? "Edit service" : "New service"`. No RLS-diagnostic panel.

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type ServiceFormValues = {
  name: string; description: string; base_price: number;
  duration_minutes: number; service_type: string; is_active: boolean;
};

const SUGGESTIONS = ["regular","deep","move_out","move_in","custom","one_time","recurring","seasonal","office","commercial"];

export function ServiceFormDialog({
  open, onOpenChange, busy, initial, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  initial?: ServiceFormValues | null;
  onSubmit: (v: ServiceFormValues) => void;
}) {
  const [v, setV] = useState<ServiceFormValues>({
    name: "", description: "", base_price: 0, duration_minutes: 60, service_type: "regular", is_active: true,
  });
  useEffect(() => {
    if (open) {
      setV(initial ?? { name: "", description: "", base_price: 0, duration_minutes: 60, service_type: "regular", is_active: true });
    }
  }, [open, initial]);

  const valid = v.name.trim().length > 0 && v.base_price >= 0 && v.duration_minutes >= 1;
  const submit = () => {
    if (!valid) return;
    onSubmit({
      ...v,
      name: v.name.trim(),
      description: v.description.trim(),
      service_type: v.service_type.trim().toLowerCase().replace(/\s+/g, "_") || "regular",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit service" : "New service"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">Name</Label>
            <Input id="svc-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-desc">Description</Label>
            <Textarea id="svc-desc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="svc-price">Base price</Label>
              <Input id="svc-price" type="number" min={0} step={0.01} value={v.base_price}
                onChange={(e) => setV({ ...v, base_price: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-dur">Duration (minutes)</Label>
              <Input id="svc-dur" type="number" min={1} step={1} value={v.duration_minutes}
                onChange={(e) => setV({ ...v, duration_minutes: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-type">Type</Label>
            <Input id="svc-type" list="svc-type-suggestions" value={v.service_type}
              onChange={(e) => setV({ ...v, service_type: e.target.value })} />
            <datalist id="svc-type-suggestions">
              {SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} /> Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || busy} loading={busy}>
            {initial ? "Save changes" : "Create service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Implement `ChecklistFormDialog`** — same `Dialog` shape; fields name (required, autofocus) + price_adder (number min 0 step 0.01). Title `initial ? "Edit checklist" : "New checklist"`. Submit disabled while invalid/busy.

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChecklistFormDialog({
  open, onOpenChange, busy, initial, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  initial?: { name: string; price_adder: number } | null;
  onSubmit: (v: { name: string; price_adder: number }) => void;
}) {
  const [name, setName] = useState("");
  const [adder, setAdder] = useState(0);
  useEffect(() => {
    if (open) { setName(initial?.name ?? ""); setAdder(initial?.price_adder ?? 0); }
  }, [open, initial]);

  const valid = name.trim().length > 0 && adder >= 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit checklist" : "New checklist"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cl-name">Name</Label>
            <Input id="cl-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-adder">Price add-on</Label>
            <Input id="cl-adder" type="number" min={0} step={0.01} value={adder}
              onChange={(e) => setAdder(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">Added to the base price when this checklist is chosen at booking.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => valid && onSubmit({ name: name.trim(), price_adder: adder })} disabled={!valid || busy} loading={busy}>
            {initial ? "Save changes" : "Create checklist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Implement `DeleteServiceDialog` and `DeleteChecklistDialog`** using `ConfirmDialog` (`@/components/ui/confirm-dialog`, props seen in Customers: `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `destructive`, `loading`, `onConfirm`).

`DeleteServiceDialog`: when `!canDelete`, render a non-destructive ConfirmDialog whose description explains it is in use (`"This service is used by N booking(s) and M recurring series. Disable it instead of deleting."`) and whose confirm is disabled or relabeled (pass `onConfirm` a no-op and hide via `confirmLabel="OK"` + non-destructive); when `canDelete`, a destructive confirm `"Delete <name>? This permanently removes the service and its checklists."`. Implement by computing title/description/confirmLabel/destructive from props and rendering one `ConfirmDialog`.

```tsx
"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteServiceDialog({
  open, onOpenChange, busy, serviceName, canDelete, appointmentCount, seriesCount, onConfirm,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean;
  serviceName: string; canDelete: boolean; appointmentCount: number; seriesCount: number;
  onConfirm: () => void;
}) {
  if (!canDelete) {
    const parts = [
      appointmentCount > 0 ? `${appointmentCount} booking${appointmentCount === 1 ? "" : "s"}` : null,
      seriesCount > 0 ? `${seriesCount} recurring series` : null,
    ].filter(Boolean).join(" and ");
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="This service is in use"
        description={`${serviceName} is used by ${parts}. Disable it instead of deleting so past records stay intact.`}
        confirmLabel="Got it"
        onConfirm={() => onOpenChange(false)}
      />
    );
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${serviceName}?`}
      description="This permanently removes the service and all of its checklists. This cannot be undone."
      confirmLabel="Delete"
      destructive
      loading={busy}
      onConfirm={onConfirm}
    />
  );
}
```

```tsx
"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteChecklistDialog({
  open, onOpenChange, busy, checklistName, itemCount, onConfirm,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean;
  checklistName: string; itemCount: number; onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${checklistName}?`}
      description={`This removes the checklist and its ${itemCount} task${itemCount === 1 ? "" : "s"}. This cannot be undone.`}
      confirmLabel="Delete"
      destructive
      loading={busy}
      onConfirm={onConfirm}
    />
  );
}
```

- [ ] **Step 4: Type-check** — `npx tsc --noEmit`. Verify the actual `ConfirmDialog` / `Dialog` / `Switch` / `Textarea` prop names match; adjust if the primitive differs (e.g. `onCheckedChange` vs `onChange`).

- [ ] **Step 5: Commit**

```bash
git add src/components/redesign/services/ServiceFormDialog.tsx src/components/redesign/services/ChecklistFormDialog.tsx src/components/redesign/services/DeleteServiceDialog.tsx src/components/redesign/services/DeleteChecklistDialog.tsx
git commit -m "feat(services): service/checklist form + delete dialogs"
```

---

### Task 10: `OperatorServicesView` (toolbar + two-pane assembly)

**Files:**
- Create: `src/components/redesign/services/OperatorServicesView.tsx`

**Interfaces:**
- Consumes: `ServicesList` (Task 5), `ServiceDetailPane` (Task 8), `ServiceRowVM`/`ServiceDetailVM`/`ChecklistVM`/`ServiceSort`/`ServiceStatusFilter` + the const sort/status arrays (Task 2), `EmptyState`/`Input`/`Select`/`Button`/`Skeleton` primitives.
- Produces: `OperatorServicesView` props (all state lifted from the container):
  ```ts
  {
    loading: boolean;
    rows: ServiceRowVM[];
    totalCount: number;       // unfiltered count for the live subtitle
    activeCount: number;
    canManage: boolean;
    search: string; onSearchChange: (s: string) => void;
    sort: ServiceSort; onSortChange: (s: ServiceSort) => void;
    status: ServiceStatusFilter; onStatusChange: (s: ServiceStatusFilter) => void;
    selectedId: string | null; onSelect: (id: string) => void;
    onNewService: () => void;
    // detail pane:
    detail: ServiceDetailVM | null;
    checklists: ChecklistVM[];
    checklistsLoading: boolean;
    detailHandlers: ServiceDetailHandlers;   // the bundle of onEdit/onToggleActive/.../checklist callbacks
  }
  ```
  Define and export a `ServiceDetailHandlers` type (the union of `ServiceDetailPane`'s callback props except `detail`/`checklists`/`checklistsLoading`/`canManage`) so the container and View agree.

- [ ] **Step 1: Implement the View**

Header: `h1` "Services" + a live-count subtitle (`"{totalCount} services · {activeCount} active"`). Toolbar: a search `Input` (with a `Search` icon), a `Select` for sort, a `Select` for status, and a primary `+ New service` button (gated by `canManage`). Layout: on `lg`, a two-column grid `lg:grid-cols-[340px_1fr] gap-5`; the left list pane has its own header/scroll; the right pane is the detail. On mobile, show the list when `!selectedId`, the detail when `selectedId` (the pane's own `‹ All services` back button clears it). Loading → list skeleton. Empty (no services at all) → `EmptyState` with `+ New service`. Anchored-left `max-w-[1700px] space-y-5`.

Mirror the toolbar/search-hero + countLabel structure of `OperatorCustomersView.tsx` (read it for the exact `Select`/`Input` usage and class rhythm). Use `Select` from `@/components/ui/select` with `SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`. Build option lists from `SERVICE_SORTS` and `SERVICE_STATUS_FILTERS`.

Responsive panel switch (key snippet):

```tsx
<div className="grid gap-5 lg:grid-cols-[340px_1fr]">
  {/* list: hidden on mobile when a service is open */}
  <aside className={cn("min-w-0", selectedId && "hidden lg:block")}>
    {loading ? <ListSkeleton /> : <ServicesList rows={rows} selectedId={selectedId} onSelect={onSelect} />}
  </aside>
  {/* detail: hidden on mobile until a service is open */}
  <section className={cn("min-w-0", !selectedId && "hidden lg:block")}>
    <ServiceDetailPane
      detail={detail}
      checklists={checklists}
      checklistsLoading={checklistsLoading}
      canManage={canManage}
      {...detailHandlers}
    />
  </section>
</div>
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` (no NEW errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/redesign/services/OperatorServicesView.tsx
git commit -m "feat(services): services view (toolbar + two-pane assembly)"
```

---

### Task 11: `OperatorServices` container (gate + Data: hooks, state, mutations, URL sync)

**Files:**
- Create: `src/components/redesign/services/OperatorServices.tsx`

**Interfaces:**
- Consumes: everything above; `useServices`/`useService` + service mutations (`createService`, `updateService`, `deleteService`, `toggleServiceActive`, `canDeleteService`, `duplicateService`), `useChecklists` + checklist mutations (`createChecklist`, `updateChecklist`, `deleteChecklist`, `duplicateChecklist`, `createLineItem`, `createLineItems`, `updateLineItem`, `deleteLineItem`, `reorderLineItems`, `reorderChecklists`), `useAuth`, `useManagerPermissions`, `useToast`, `useRouter`/`useSearchParams`/`usePathname`.
- Produces: default export `OperatorServices` (the gate) consumed by the page (Task 12).

- [ ] **Step 1: Implement the permission gate** (mirror `OperatorCustomers`)

```tsx
export function OperatorServices() {
  const { currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();
  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canManage = privileged || !!permissions?.can_manage_services;
  const canView = canManage || !!permissions?.can_view_services;

  if (!privileged && permsLoading) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!canView) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <EmptyState icon={<ShieldAlert />} title="You do not have access to services"
          description="Ask an owner or admin to grant you the services permission." />
      </div>
    );
  }
  return <OperatorServicesData canManage={canManage} />;
}
```

- [ ] **Step 2: Implement `OperatorServicesData`** — the orchestrator. Responsibilities:
  - `const { services, loading, maxChecklistAdderByServiceId, refetch, refreshMaxChecklistAdders } = useServices();`
  - URL selection: `const selectedId = searchParams.get("service")`. `onSelect(id)` → `router.replace(\`${pathname}?service=${id}\`, { scroll: false })`. On first load, if `!selectedId && services.length` (desktop), select the first (only when viewport is `lg` — guard with a `matchMedia("(min-width: 1024px)")` check inside a `useEffect`, so mobile starts on the list).
  - `const { checklists, loading: checklistsLoading, applyLineItem*, applyChecklist*, refetch: refetchChecklists } = useChecklists(selectedId);`
  - Derive rows: `useMemo(() => sortServices(filterServices(services, { search, status }), sort).map(toRowVM)`, where `toRowVM(s)` builds `ServiceRowVM` using `rowPriceLabel(s.base_price, maxChecklistAdderByServiceId[s.id] ?? 0)`, `formatDuration`, `serviceTypeLabel`.
  - Derive `detail` from the selected service via `toDetailVM(s)` (uses `priceRangeLabel`, `basePriceLabel = formatPrice(base)`).
  - Derive `checklistVMs` = `sortChecklists(checklists).map((c) => ({ id, name, priceAdder: c.price_adder, priceAdderLabel: priceAdderLabel(c.price_adder), tasks: (c.checklist_line_items ?? []).map((i) => ({ id: i.id, task: i.task })) }))`.
  - State: `search`, `sort` (default `"name"`), `status` (default `"active"`), dialog states (`serviceDialog: {mode:'create'|'edit'} | null`, `checklistDialog: {mode, checklistId?} | null`, `deleteService: {...} | null`, `deleteChecklist: {id, name, itemCount} | null`), `busy`.
  - Mutation handlers (each: call the hook fn, optimistic apply where a helper exists, `showToast` on success/error, `refetch`/`refreshMaxChecklistAdders` as needed). Money/price-range labels recompute from `maxChecklistAdderByServiceId`, so after any checklist add/edit/duplicate/delete call `refreshMaxChecklistAdders()`.
  - Bundle the detail callbacks into a `detailHandlers` object matching `ServiceDetailHandlers`.
  - Render `<OperatorServicesView ... />` plus the four dialogs (Task 9), wired like `OperatorCustomers` wires `CustomerDetailSheet`/`AddCustomerDialog`/`ConfirmDialog`.

Concrete handler examples (follow these shapes for the rest):

```tsx
const orgId = currentOrganizationId ?? "";

const handleCreateService = useCallback(async (v: ServiceFormValues) => {
  setBusy(true);
  try {
    const r = await createService(orgId, v);
    if (r.success && r.data) {
      showToast("Service created", { variant: "success" });
      setServiceDialog(null);
      onSelect(r.data.id);
      refreshMaxChecklistAdders();
    } else {
      showToast(r.error || "Could not create the service", { variant: "error" });
    }
  } finally { setBusy(false); }
}, [orgId, showToast, onSelect, refreshMaxChecklistAdders]);

const handleReorderTasks = useCallback(async (checklistId: string, orderedIds: string[]) => {
  const cl = checklists.find((c) => c.id === checklistId);
  const prevItems = cl?.checklist_line_items ?? [];
  const byId = new Map(prevItems.map((i) => [i.id, i]));
  const nextItems = orderedIds.map((id, idx) => ({ ...(byId.get(id) as ChecklistLineItem), position: idx }));
  applyLineItemsReordered(checklistId, nextItems);            // optimistic
  const r = await reorderLineItems(checklistId, orderedIds);
  if (!r.success) { await refetchChecklists(); showToast(r.error || "Could not reorder tasks", { variant: "error" }); }
}, [checklists, applyLineItemsReordered, refetchChecklists, showToast]);

const handleAddTasks = useCallback(async (checklistId: string, raw: string) => {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return;
  const r = lines.length === 1
    ? await createLineItem(checklistId, lines[0])
    : await createLineItems(checklistId, lines);
  if (r.success) { await refetchChecklists(); }
  else { showToast(r.error || "Could not add the task", { variant: "error" }); }
}, [refetchChecklists, showToast]);

const handleToggleActive = useCallback(async (next: boolean) => {
  if (!detail) return;
  updateServiceInState(detail.id, { is_active: next });        // optimistic
  const r = await toggleServiceActive(detail.id, next, orgId);
  if (!r.success) { updateServiceInState(detail.id, { is_active: !next }); showToast(r.error || "Could not update the service", { variant: "error" }); }
}, [detail, orgId, updateServiceInState, showToast]);

const handleDeleteServiceClick = useCallback(async () => {
  if (!detail) return;
  const c = await canDeleteService(detail.id);
  setDeleteService({ id: detail.id, name: detail.name, ...c });
}, [detail]);

const handleConfirmDeleteService = useCallback(async () => {
  if (!deleteService) return;
  setBusy(true);
  try {
    const r = await deleteService(deleteService.id);
    if (r.success) {
      showToast("Service deleted", { variant: "success" });
      setDeleteService(null);
      router.replace(pathname, { scroll: false });            // clear ?service
      await refetch();
    } else { showToast(r.error || "Could not delete the service", { variant: "error" }); }
  } finally { setBusy(false); }
}, [deleteService, showToast, router, pathname, refetch]);
```

Write the remaining handlers (`handleEditService`/`handleUpdateService`, `handleDuplicateService`, `handleAddChecklist`/`handleCreateChecklist`, `handleEditChecklist`/`handleUpdateChecklist`, `handleDuplicateChecklist`, `handleDeleteChecklistClick`/`handleConfirmDeleteChecklist`, `handleSaveTask`, `handleDeleteTask`, `handleReorderChecklists`) following the same shapes: optimistic-apply where a helper exists; otherwise `await mutation` then `await refetchChecklists()`; toast on error; `refreshMaxChecklistAdders()` after any checklist add/edit/duplicate/delete; `setBusy` around dialog-driven mutations.

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` (no NEW errors). This task is the integration point; resolve all VM/handler type mismatches here.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/services/OperatorServices.tsx
git commit -m "feat(services): operator services container (gate, state, mutations, URL sync)"
```

---

### Task 12: Route wrapper + nav repoint

**Files:**
- Create: `src/app/(redesign)/app/admin-dashboard/services/page.tsx`
- Modify: `src/components/redesign/shell/nav-items.ts:35`

**Interfaces:**
- Consumes: `OperatorServices` (Task 11), `OperatorShell`.

- [ ] **Step 1: Create the page** (mirror `customers/page.tsx`, swap component + `active`)

```tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import WorkspaceErrorScreen from "@/components/WorkspaceErrorScreen";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorServices } from "@/components/redesign/services/OperatorServices";

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

function OperatorServicesInner() {
  const router = useRouter();
  const { user, loading, orgStatus, reloadOrganization } = useAuth();
  useEffect(() => { if (!loading && !user) router.push("/login"); }, [user, loading, router]);
  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") return <Spinner />;
  if (orgStatus === "error") return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  const goNewBooking = () => router.push("/admin-dashboard?tab=bookings");
  return (
    <OperatorShell active="services" onNewBooking={goNewBooking}>
      <OperatorServices />
    </OperatorShell>
  );
}

export default function OperatorServicesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OperatorServicesInner />
    </Suspense>
  );
}
```

- [ ] **Step 2: Repoint the nav** at `src/components/redesign/shell/nav-items.ts:35`

```diff
- { id: "services", label: "Services", href: "/admin-dashboard?tab=services", icon: Tag },
+ { id: "services", label: "Services", href: "/app/admin-dashboard/services", icon: Tag },
```

- [ ] **Step 3: Type-check + lint** — `npx tsc --noEmit` then `npm run lint` (no NEW errors).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(redesign)/app/admin-dashboard/services/page.tsx" src/components/redesign/shell/nav-items.ts
git commit -m "feat(services): route wrapper + nav points Services at the redesign screen"
```

---

### Task 13: Verification pass + gates

**Files:** none (verification only; small fixes land as follow-up commits).

- [ ] **Step 1: Full unit suite + types + lint**

Run: `npm run test` then `npx tsc --noEmit` then `npm run lint`
Expected: tests green (including `deriveServices`); no NEW type/lint errors you introduced.

- [ ] **Step 2: Visual verification with Playwright MCP** (against `npm run dev`, redesign flag enabled, signed in as an owner/admin)

Navigate to `/app/admin-dashboard/services` and verify, taking a screenshot at each: (a) two-pane list + auto-selected first service on desktop; (b) create a service (it appears + selects); (c) edit it; (d) toggle active/inactive; (e) duplicate service (clone appears with the same checklists, no stray empty default); (f) add a checklist; edit it; duplicate it; delete it; (g) add a single task, then bulk-paste multiple tasks; edit a task; delete a task; (h) drag to reorder tasks; drag to reorder checklists (order persists on reload); (i) delete-protection path on an in-use service shows the "disable instead" copy; (j) narrow the viewport: list↔detail switch + `‹ All services` back works; (k) sign in as a manager with only `can_view_services` → read-only (no add/edit/drag/delete affordances); with `can_manage_services` → full; with neither → access-denied state. Confirm no em dashes anywhere in the rendered copy.

- [ ] **Step 3: If a migration is involved, confirm schema rebuild** (Docker required)

Run: `npx supabase db reset`
Expected: clean rebuild through `090`; then re-run `npm run test`.

- [ ] **Step 4: Codex branch review, then push + PR** (per CLAUDE.md)

```bash
node "<codex-plugin>/scripts/codex-companion.mjs" review --scope branch --base master
```

Apply valid findings as a `fix: address Codex review` commit, then:

```bash
git push -u origin feat/redesign-operator-services
```

Open a PR to `master`; ensure CI (typecheck+lint, unit+integration) and E2E are green before merge.

---

## Self-Review

**Spec coverage** (each spec section → task):
- §1 goal / kill middle hop → Tasks 10–12 (two-pane View + container + route).
- §2 domain model / preserved behaviors → Tasks 3–4 (default-checklist trigger handled in `duplicateService`), 9 (delete-protection), 11 (active toggle, auto-default kept by not deleting it on normal create).
- §3 layout/IA (two-pane, toolbar, URL `?service`, mobile switch) → Tasks 10–11.
- §4 component architecture (file list) → Tasks 5–11 create exactly those files (presenters folded into `ServiceDetailPane`/derive as noted below).
- §5 data layer (migration 090, reorderChecklists, duplicateChecklist, createLineItems, duplicateService, trigger gotcha) → Tasks 1, 3, 4.
- §6 pure helpers + tests → Task 2.
- §7 interactions (dnd reorder, inline edit, bulk add, dialogs, toggle, delete) → Tasks 6–9, 11.
- §8 states + gating (outer gate + inner Data, read-only manager) → Tasks 8 (skeletons/empty), 11 (gate).
- §9 upgrades (duplicate service/checklist, bulk add) → Tasks 3, 4, 6, 11.
- §10 nav wiring → Task 12.
- §11 testing/verification → Tasks 2, 13.

**Deviations from spec (intentional):**
- `services-presenters.tsx` is NOT created as a separate file. The status badge is a 2-line inline `Badge` in `ServiceDetailPane`, and price labels live in `deriveServices.ts` (testable). One fewer file, same behavior, no information hidden.
- The "reorder reindex" helper is not a separate pure function: ordering uses dnd-kit `arrayMove` in the components and the hook reorder fns take `orderedIds` directly (the index IS the new position). `sortChecklists` (tested) covers the ordering logic; arrayMove is library code.

**Placeholder scan:** none — every code step has complete code; UI tasks that mirror a shipped file name it explicitly and give the full props interface + key snippets.

**Type consistency:** `ServiceFormValues`, `ServiceRowVM`/`ServiceDetailVM`/`ChecklistVM`/`TaskVM`, the sort/status enums, and the `ServiceDetailHandlers` bundle are defined once (Tasks 2/9/10) and referenced unchanged downstream. Hook fns (`reorderChecklists`, `duplicateChecklist`, `createLineItems`, `duplicateService`) keep one signature across Tasks 3/4 and their call sites in Task 11.

**Note on testing reality:** only `deriveServices` is unit-tested (matching how Bookings/Customers are tested — derive logic only). The hook mutations are direct Supabase I/O (no `/api` route, so no integration harness applies) and the components are verified via `tsc` + the Playwright MCP pass in Task 13. This is the repo's established convention, not a gap.
