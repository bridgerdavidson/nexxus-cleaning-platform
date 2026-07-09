# Manager Permission Model + Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. New API-route behavior REQUIRES a co-located `*.integration.test.ts` (see `create-tests` skill).

**Goal:** Make every manager permission flag actually enforced server-side (closing the payment/booking holes), collapse the flag set to a single canonical registry, and give new managers a correct invite-carried default posture.

**Architecture:** A new `src/lib/permissions/managerFlags.ts` registry is the single source of truth for the 14 flags (the two request flags are merged). A new `requireManagerPermission(request, orgId, supabaseAdmin, flag, { allowedRoles })` guard (generalizing the existing `requireOrgPaymentsAuth`) gates the manager branch of every sensitive API route. Direct-client tables (service_types, properties) get their flags enforced via RLS migrations mirroring the 075 org+flag pattern. Invites carry a `manager_permissions` jsonb so `accept-invite` persists chosen permissions instead of seeding all-true.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Supabase (Postgres + RLS), Vitest 3 (unit + integration projects), local Supabase via `npx supabase`.

## Global Constraints

- Path alias `@/*` → `./src/*`. Tests reach `tests/helpers/*` by **relative** path (the alias does not cover them), e.g. from `src/app/api/<x>/` use `../../../../tests/helpers/...` (count the `../` to repo root).
- Two Vitest projects, selected by filename: `*.test.ts` = **unit** (no infra, stub env), `*.integration.test.ts` = **integration** (needs `npx supabase start` + `.env.test.local`). Co-locate both next to their source.
- Migrations are immutable once shipped; never edit `000_baseline.sql` or any existing migration. Next migration number is **103**. Migration header convention (074/075/076 form): first line `-- 103_<name>.sql`, blank comment line, then a prose rationale. Wrap `auth.uid()` as `(select auth.uid())` in every policy predicate and scope policies `TO authenticated`.
- The `manager_permissions` join key is `manager_permissions.manager_id = organization_members.user_id`; rows are `(manager_id, organization_id)`-scoped.
- Owner/admin ALWAYS bypass fine-grained flags; the flag is consulted only when the caller's OrgRole is `manager`. Fail closed (missing row or falsy flag → deny).
- No em dashes in any user-facing copy (error strings, labels, toasts).
- Before pushing: `npm run test`, `npx tsc --noEmit`, `npm run lint` all green; `npx supabase db reset` rebuilds cleanly.

**The 14 canonical flags** (post-merge; `can_approve_decline_bookings` is removed, folded into `can_handle_requests`):
`can_view_bookings, can_edit_bookings, can_handle_requests, can_view_customers, can_edit_customers, can_view_properties, can_edit_properties, can_view_services, can_manage_services, can_view_payments, can_manage_payments, can_view_analytics, can_view_messages, can_manage_cleaners`.

---

## Task 1: Canonical manager-flag registry (single source of truth)

**Files:**
- Create: `src/lib/permissions/managerFlags.ts`
- Test: `src/lib/permissions/managerFlags.test.ts`

**Interfaces:**
- Produces:
  - `type ManagerPermissionKey` — union of the 14 flag keys.
  - `interface ManagerPermissions = Record<ManagerPermissionKey, boolean>` (exported, replaces the one in `useAdminData.ts`).
  - `const MANAGER_FLAG_KEYS: ManagerPermissionKey[]` — ordered.
  - `const MANAGER_FLAGS: ManagerFlag[]` where `ManagerFlag = { key: ManagerPermissionKey; label: string; description: string; group: ManagerFlagGroup; enforce: 'route' | 'rls' | 'rpc' | 'ui' }`.
  - `const MANAGER_FLAG_GROUPS: ManagerFlagGroup[]` — ordered group names.
  - `function emptyManagerPermissions(): ManagerPermissions` — all false.
  - `const STANDARD_MANAGER_PRESET: ManagerPermissions` — 9 on / 5 off.
  - `function coerceManagerPermissions(row: Partial<Record<string, unknown>> | null): ManagerPermissions` — every key `Boolean(row?.[key])`, missing → false.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/permissions/managerFlags.test.ts
import { describe, it, expect } from 'vitest';
import {
  MANAGER_FLAG_KEYS,
  MANAGER_FLAGS,
  MANAGER_FLAG_GROUPS,
  STANDARD_MANAGER_PRESET,
  emptyManagerPermissions,
  coerceManagerPermissions,
} from './managerFlags';

describe('managerFlags registry', () => {
  it('has exactly 14 flags with no duplicates and no removed flag', () => {
    expect(MANAGER_FLAG_KEYS).toHaveLength(14);
    expect(new Set(MANAGER_FLAG_KEYS).size).toBe(14);
    expect(MANAGER_FLAG_KEYS).not.toContain('can_approve_decline_bookings');
    expect(MANAGER_FLAG_KEYS).toContain('can_handle_requests');
  });

  it('every flag has a definition with a known group', () => {
    for (const key of MANAGER_FLAG_KEYS) {
      const def = MANAGER_FLAGS.find((f) => f.key === key);
      expect(def, `missing def for ${key}`).toBeTruthy();
      expect(MANAGER_FLAG_GROUPS).toContain(def!.group);
    }
  });

  it('emptyManagerPermissions is all false', () => {
    const empty = emptyManagerPermissions();
    expect(Object.values(empty).every((v) => v === false)).toBe(true);
    expect(Object.keys(empty).sort()).toEqual([...MANAGER_FLAG_KEYS].sort());
  });

  it('STANDARD_MANAGER_PRESET has 9 on / 5 off with the sensitive flags off', () => {
    const on = MANAGER_FLAG_KEYS.filter((k) => STANDARD_MANAGER_PRESET[k]);
    expect(on).toHaveLength(9);
    for (const off of ['can_edit_properties', 'can_manage_services', 'can_view_payments', 'can_manage_payments', 'can_manage_cleaners'] as const) {
      expect(STANDARD_MANAGER_PRESET[off]).toBe(false);
    }
  });

  it('coerceManagerPermissions defaults missing/falsey keys to false', () => {
    const p = coerceManagerPermissions({ can_view_bookings: true, can_edit_bookings: 1 as unknown });
    expect(p.can_view_bookings).toBe(true);
    expect(p.can_edit_bookings).toBe(true);
    expect(p.can_manage_payments).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/permissions/managerFlags.test.ts`
Expected: FAIL (`Failed to resolve import './managerFlags'`).

- [ ] **Step 3: Write the registry**

```ts
// src/lib/permissions/managerFlags.ts
export const MANAGER_FLAG_GROUPS = [
  'Bookings',
  'Customers',
  'Properties',
  'Services',
  'Payments & payouts',
  'Insight & comms',
  'Cleaners & team',
] as const;
export type ManagerFlagGroup = (typeof MANAGER_FLAG_GROUPS)[number];

export interface ManagerFlag {
  key: ManagerPermissionKey;
  label: string;
  description: string;
  group: ManagerFlagGroup;
  enforce: 'route' | 'rls' | 'rpc' | 'ui';
}

export const MANAGER_FLAGS = [
  { key: 'can_view_bookings', label: 'View bookings', description: 'See the bookings calendar and lists.', group: 'Bookings', enforce: 'route' },
  { key: 'can_edit_bookings', label: 'Create & edit bookings', description: 'Create, update, cancel and reschedule appointments.', group: 'Bookings', enforce: 'route' },
  { key: 'can_handle_requests', label: 'Handle requests', description: 'Approve or decline pending requests and assign cleaners.', group: 'Bookings', enforce: 'route' },
  { key: 'can_view_customers', label: 'View customers', description: 'See customer profiles and history.', group: 'Customers', enforce: 'ui' },
  { key: 'can_edit_customers', label: 'Edit customers', description: 'Edit customer details and invite homeowners.', group: 'Customers', enforce: 'route' },
  { key: 'can_view_properties', label: 'View properties', description: 'See property details and access notes.', group: 'Properties', enforce: 'rls' },
  { key: 'can_edit_properties', label: 'Edit properties', description: 'Create and update property records.', group: 'Properties', enforce: 'rls' },
  { key: 'can_view_services', label: 'View services', description: 'See the service catalog.', group: 'Services', enforce: 'ui' },
  { key: 'can_manage_services', label: 'Manage services', description: 'Edit pricing and service types.', group: 'Services', enforce: 'rls' },
  { key: 'can_view_payments', label: 'View payments', description: 'See payments, invoices and payout status.', group: 'Payments & payouts', enforce: 'rpc' },
  { key: 'can_manage_payments', label: 'Manage payments', description: 'Charge cards, record payments, create invoices and manage payouts.', group: 'Payments & payouts', enforce: 'route' },
  { key: 'can_view_analytics', label: 'View analytics', description: 'See analytics and reports (money figures hidden unless View payments is on).', group: 'Insight & comms', enforce: 'rpc' },
  { key: 'can_view_messages', label: 'View messages', description: 'See and use the messaging inbox.', group: 'Insight & comms', enforce: 'ui' },
  { key: 'can_manage_cleaners', label: 'Manage cleaners', description: 'Invite, edit and remove cleaners.', group: 'Cleaners & team', enforce: 'route' },
] as const satisfies readonly ManagerFlag[];

export type ManagerPermissionKey = (typeof MANAGER_FLAGS)[number]['key'];
export type ManagerPermissions = Record<ManagerPermissionKey, boolean>;

export const MANAGER_FLAG_KEYS = MANAGER_FLAGS.map((f) => f.key) as ManagerPermissionKey[];

export function emptyManagerPermissions(): ManagerPermissions {
  return MANAGER_FLAG_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as ManagerPermissions);
}

export function coerceManagerPermissions(
  row: Partial<Record<string, unknown>> | null | undefined,
): ManagerPermissions {
  return MANAGER_FLAG_KEYS.reduce((acc, k) => {
    acc[k] = Boolean(row?.[k]);
    return acc;
  }, {} as ManagerPermissions);
}

const PRESET_ON: ManagerPermissionKey[] = [
  'can_view_bookings', 'can_edit_bookings', 'can_handle_requests',
  'can_view_customers', 'can_edit_customers',
  'can_view_properties', 'can_view_services',
  'can_view_analytics', 'can_view_messages',
];

export const STANDARD_MANAGER_PRESET: ManagerPermissions = MANAGER_FLAG_KEYS.reduce((acc, k) => {
  acc[k] = PRESET_ON.includes(k);
  return acc;
}, {} as ManagerPermissions);

/** Comma-separated column list for a `manager_permissions` .select(). */
export const MANAGER_FLAG_SELECT = MANAGER_FLAG_KEYS.join(', ');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/permissions/managerFlags.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/managerFlags.ts src/lib/permissions/managerFlags.test.ts
git commit -m "feat(permissions): canonical manager-flag registry (single source of truth)"
```

---

## Task 2: `requireManagerPermission` guard + refactor `requireOrgPaymentsAuth`

**Files:**
- Create: `src/lib/auth/requireManagerPermission.ts`
- Modify: `src/lib/auth/requireOrgPaymentsAuth.ts` (delegate to the new guard)
- Test: `src/lib/auth/requireManagerPermission.integration.test.ts`

**Interfaces:**
- Consumes: `requireOrgAuth`, `type OrgRole`, `type RequireOrgAuthResult` from `./requireOrgAuth`; `type ManagerPermissionKey` from `@/lib/permissions/managerFlags`.
- Produces: `requireManagerPermission(request: NextRequest, organizationId: string | null | undefined, supabaseAdmin: SupabaseClient, flag: ManagerPermissionKey, options?: { allowedRoles?: OrgRole[]; errorMessage?: string }): Promise<RequireOrgAuthResult>`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/lib/auth/requireManagerPermission.integration.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { requireManagerPermission } from './requireManagerPermission';
import { createTestSupabaseClient } from '../../../tests/helpers/supabase';
import { withTestOrg, addManagerToOrg } from '../../../tests/helpers/fixtures';

const admin = createTestSupabaseClient();
const req = (token?: string) =>
  new NextRequest('http://t.local/x', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

let org: Awaited<ReturnType<typeof withTestOrg>> | null = null;
let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

afterEach(async () => {
  if (mgr) { await mgr.cleanup(); mgr = null; }
  if (org) { await org.cleanup(); org = null; }
});

describe('requireManagerPermission', () => {
  it('401 without a token', async () => {
    org = await withTestOrg();
    const r = await requireManagerPermission(req(), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it('admin bypasses the flag (200)', async () => {
    org = await withTestOrg();
    const r = await requireManagerPermission(req(org.admin.accessToken), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(true);
  });

  it('manager WITHOUT the flag is 403', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
    const r = await requireManagerPermission(req(mgr.accessToken), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it('manager WITH the flag passes (200)', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    const r = await requireManagerPermission(req(mgr.accessToken), org.organizationId, admin, 'can_edit_bookings');
    expect(r.ok).toBe(true);
  });

  it('respects allowedRoles: a homeowner passes when whitelisted, without needing the flag', async () => {
    org = await withTestOrg();
    const r = await requireManagerPermission(
      req(org.homeowner.accessToken), org.organizationId, admin, 'can_edit_bookings',
      { allowedRoles: ['owner', 'admin', 'manager', 'homeowner'] },
    );
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- src/lib/auth/requireManagerPermission.integration.test.ts` (requires `npx supabase start`).
Expected: FAIL (`Failed to resolve import './requireManagerPermission'`).

- [ ] **Step 3: Write the guard**

```ts
// src/lib/auth/requireManagerPermission.ts
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgAuth, type OrgRole, type RequireOrgAuthResult } from './requireOrgAuth';
import type { ManagerPermissionKey } from '@/lib/permissions/managerFlags';

export interface RequireManagerPermissionOptions {
  /** Roles allowed on the route. Default ['owner','admin','manager']. Non-manager
   *  allowed roles pass WITHOUT the flag; only 'manager' is gated by it. */
  allowedRoles?: OrgRole[];
  errorMessage?: string;
}

/**
 * Authorize a fine-grained manager action. Owner/admin (and any other role listed in
 * allowedRoles) pass; a caller whose OrgRole is 'manager' passes ONLY if the given
 * manager_permissions flag is true. Fails closed. Returns the same RequireOrgAuthResult
 * as requireOrgAuth so callers keep `auth.userId` / `auth.role`.
 */
export async function requireManagerPermission(
  request: NextRequest,
  organizationId: string | null | undefined,
  supabaseAdmin: SupabaseClient,
  flag: ManagerPermissionKey,
  options: RequireManagerPermissionOptions = {},
): Promise<RequireOrgAuthResult> {
  const allowedRoles = options.allowedRoles ?? ['owner', 'admin', 'manager'];
  const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, { allowedRoles });
  if (!auth.ok) return auth;

  if (auth.role === 'manager') {
    const { data } = await supabaseAdmin
      .from('manager_permissions')
      .select(flag)
      .eq('manager_id', auth.userId)
      .eq('organization_id', organizationId!)
      .maybeSingle();
    if (!(data as Record<string, boolean> | null)?.[flag]) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: options.errorMessage ?? `Requires the ${flag} permission` },
          { status: 403 },
        ),
      };
    }
  }
  return auth;
}
```

- [ ] **Step 4: Refactor `requireOrgPaymentsAuth` to delegate (DRY)**

Replace the whole body of `src/lib/auth/requireOrgPaymentsAuth.ts` with:

```ts
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequireOrgAuthResult } from './requireOrgAuth';
import { requireManagerPermission } from './requireManagerPermission';

/**
 * Authorize a payment-spending action: owner/admin pass, a manager passes only with
 * `can_manage_payments`. Thin wrapper over requireManagerPermission (kept for its
 * existing call sites and error copy).
 */
export async function requireOrgPaymentsAuth(
  request: NextRequest,
  organizationId: string | null | undefined,
  supabaseAdmin: SupabaseClient,
): Promise<RequireOrgAuthResult> {
  return requireManagerPermission(request, organizationId, supabaseAdmin, 'can_manage_payments', {
    errorMessage: 'Requires the Manage Payments permission',
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:integration -- src/lib/auth/requireManagerPermission.integration.test.ts`
Expected: PASS (5 tests).
Run: `npm run test:integration -- src/app/api/appointments/[appointmentId]/charge/route.integration.test.ts` (regression on the existing requireOrgPaymentsAuth caller).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/requireManagerPermission.ts src/lib/auth/requireManagerPermission.integration.test.ts src/lib/auth/requireOrgPaymentsAuth.ts
git commit -m "feat(auth): requireManagerPermission guard; requireOrgPaymentsAuth delegates to it"
```

---

## Task 3: Flag-merge migration + drop `can_approve_decline_bookings` everywhere

**Files:**
- Create: `supabase/migrations/103_merge_manager_request_flags.sql`
- Modify: `src/app/api/appointments/assign-cleaner/route.ts` (drop the OR-of-two → `can_handle_requests`)
- Modify: `src/app/api/appointments/reassign-cleaner/route.ts` (same)
- Modify: `src/app/api/admin/update-manager-permissions/route.ts` (remove the flag from destructure + upsert)
- Modify: `src/app/api/accept-invite/route.ts` (remove the flag from the seed block — Task 7 rewrites this block; here just delete the one line)
- Modify: `src/components/redesign/settings/sections.test.ts` and `src/lib/settings.test.ts` (remove the key from any full `ManagerPermissions` literal)
- Modify: `tests/helpers/fixtures.ts` (`addManagerToOrg` must stop inserting the dropped column — else every integration test's manager seed 500s)

**Interfaces:**
- Consumes: nothing new.
- Produces: DB no longer has `manager_permissions.can_approve_decline_bookings`; all readers use `can_handle_requests`.

- [ ] **Step 1: Write the migration**

```sql
-- 103_merge_manager_request_flags.sql
--
-- Collapse the two overlapping request permissions into one. Historically
-- can_handle_requests and can_approve_decline_bookings both merely unlocked
-- assign/reassign; keeping both was a UX and enforcement trap. OR the two on
-- every existing row, then drop the redundant column. can_approve_decline_bookings
-- is referenced by NO RLS policy (only app/route code), so dropping it is safe.

UPDATE public.manager_permissions
SET can_handle_requests = can_handle_requests OR can_approve_decline_bookings
WHERE can_approve_decline_bookings = true
  AND can_handle_requests = false;

ALTER TABLE public.manager_permissions
  DROP COLUMN IF EXISTS can_approve_decline_bookings;
```

- [ ] **Step 2: Apply and verify the schema rebuilds**

Run: `npx supabase db reset`
Expected: completes with no error; `manager_permissions` no longer has the column.

- [ ] **Step 3: Update `assign-cleaner` and `reassign-cleaner`**

In `src/app/api/appointments/assign-cleaner/route.ts`, the manager flag block (around lines 34-48) currently selects `can_handle_requests, can_approve_decline_bookings` and denies unless one is true. Change the `.select(...)` to just `'can_handle_requests'` and the deny condition to check only `can_handle_requests`. Do the identical edit in `reassign-cleaner/route.ts` (block around lines 45-59). Concretely, both blocks become:

```ts
if (auth.role === 'manager') {
  const { data: perm } = await supabaseAdmin
    .from('manager_permissions')
    .select('can_handle_requests')
    .eq('manager_id', auth.userId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!(perm as { can_handle_requests: boolean } | null)?.can_handle_requests) {
    return NextResponse.json({ error: 'Requires the Handle Requests permission' }, { status: 403 });
  }
}
```

(Keep each route's existing `organizationId` variable name and its existing import of `type OrgRole` if the surrounding code still uses it; remove the `satisfies OrgRole` idiom only if it becomes unused.)

- [ ] **Step 4: Update `update-manager-permissions/route.ts`**

Remove `can_approve_decline_bookings` from the request destructure (line ~15) and from the upsert object (line ~71). The route will now write only the 14 columns that exist.

- [ ] **Step 5: Update `accept-invite/route.ts` seed block**

In the seeding block (lines ~203-234), delete the `can_approve_decline_bookings: true,` line. (Task 7 replaces this whole block; this keeps the tree compiling in the meantime.)

- [ ] **Step 6: Fix test fixtures + helpers that hard-code the flag**

- In `src/components/redesign/settings/sections.test.ts` and `src/lib/settings.test.ts`, remove `can_approve_decline_bookings` from any object-literal that enumerates all `ManagerPermissions` keys.
- In `tests/helpers/fixtures.ts`, update `addManagerToOrg` so the `manager_permissions` insert no longer references `can_approve_decline_bookings` (the column is gone after migration 103). Prefer building the insert from the registry: import `MANAGER_FLAG_KEYS, emptyManagerPermissions` from `../../src/lib/permissions/managerFlags` and construct the row as `{ manager_id, organization_id, ...emptyManagerPermissions(), ...overrides }`, and type the `permissions` param as `Partial<Record<ManagerPermissionKey, boolean>>` importing `ManagerPermissionKey` from the registry. This keeps the helper in lockstep with the flag set forever.

- [ ] **Step 7: Typecheck + run affected tests**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `can_approve_decline_bookings`.
Run: `npm run test:integration -- assign-cleaner reassign-cleaner update-manager-permissions`
Expected: PASS.
Run: `npm run test:unit -- src/lib/settings.test.ts src/components/redesign/settings/sections.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/103_merge_manager_request_flags.sql src/app/api/appointments/assign-cleaner/route.ts src/app/api/appointments/reassign-cleaner/route.ts src/app/api/admin/update-manager-permissions/route.ts src/app/api/accept-invite/route.ts src/components/redesign/settings/sections.test.ts src/lib/settings.test.ts tests/helpers/fixtures.ts
git commit -m "refactor(permissions): merge can_approve_decline_bookings into can_handle_requests (migration 103)"
```

---

## Task 4: Enforce `can_manage_payments` on the four payment routes + non-self-pay charge

**Files:**
- Modify: `src/app/api/invoices/create/route.ts`
- Modify: `src/app/api/payments/record/route.ts`
- Modify: `src/app/api/stripe/create-payment-intent/route.ts`
- Modify: `src/app/api/billing/card-links/route.ts`
- Modify: `src/app/api/appointments/[appointmentId]/charge/route.ts`
- Test: co-located `*.integration.test.ts` for each of the four (create/update existing where present) + extend `charge/route.integration.test.ts`

**Interfaces:**
- Consumes: `requireOrgPaymentsAuth` (already exists, now delegates to the guard).

- [ ] **Step 1: Wire the four role-only routes**

In each of `invoices/create`, `payments/record`, `stripe/create-payment-intent`, `billing/card-links`: replace the current
`const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, { allowedRoles: ['owner', 'admin', 'manager'] });`
with
`const auth = await requireOrgPaymentsAuth(request, organization_id, supabaseAdmin);`
Add the import `import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';` and remove the now-unused `requireOrgAuth` import if nothing else in the file uses it. Leave the `if (!auth.ok) return auth.response;` line and all downstream `auth.userId` usage unchanged (identical return shape).

- [ ] **Step 2: Fix the non-self-pay charge path**

In `src/app/api/appointments/[appointmentId]/charge/route.ts`, the inline manager check at line ~72 is guarded by `is_self_pay === true && auth.role === 'manager'`. Widen it so ANY manager-triggered charge requires the permission. Change the condition to `auth.role === 'manager'` (drop the `is_self_pay === true &&` clause). Do NOT change `allowedRoles` (cleaner must remain allowed to charge their own completed job).

- [ ] **Step 3: Write/extend the integration tests**

For each route, add a test asserting a manager WITHOUT `can_manage_payments` gets 403 and one WITH it succeeds (200/expected). Use `addManagerToOrg`. Model — new file `src/app/api/payments/record/route.integration.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg } from '../../../../tests/helpers/fixtures';

let org: Awaited<ReturnType<typeof withTestOrg>> | null = null;
let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

afterEach(async () => {
  if (mgr) { await mgr.cleanup(); mgr = null; }
  if (org) { await org.cleanup(); org = null; }
});

describe('POST /api/payments/record manager gate', () => {
  it('403 for a manager without can_manage_payments', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_manage_payments: false });
    const res = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: org.organizationId, appointment_id: crypto.randomUUID(), amount: 100, payment_method: 'card' },
    });
    expect(res.status).toBe(403);
  });

  it('lets a manager WITH can_manage_payments past the auth gate', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_manage_payments: true });
    const res = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(mgr.accessToken),
      body: { organization_id: org.organizationId, appointment_id: crypto.randomUUID(), amount: 100, payment_method: 'card' },
    });
    // Past auth: not a 401/403. (May 400/404/500 on the fake appointment id — that's fine, we only assert the gate.)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
```

Replicate for `invoices/create`, `stripe/create-payment-intent`, `billing/card-links` (adjust the required body fields per each route's destructure). For `charge`, add a case: manager without `can_manage_payments` charging a NON-self-pay appointment → 403.

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- invoices/create payments/record create-payment-intent card-links charge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/invoices/create/route.ts src/app/api/payments/record/route.ts src/app/api/stripe/create-payment-intent/route.ts src/app/api/billing/card-links/route.ts src/app/api/appointments/[appointmentId]/charge/route.ts src/app/api/invoices/create/route.integration.test.ts src/app/api/payments/record/route.integration.test.ts src/app/api/stripe/create-payment-intent/route.integration.test.ts src/app/api/billing/card-links/route.integration.test.ts src/app/api/appointments/[appointmentId]/charge/route.integration.test.ts
git commit -m "feat(permissions): enforce can_manage_payments on payment-spending routes"
```

---

## Task 5: Enforce booking flags on the booking-mutation routes

**Files:**
- Modify: `src/app/api/recurring-appointments/route.ts` (POST → `can_edit_bookings`; GET → `can_view_bookings`)
- Modify: `src/app/api/appointments/accept-counter-proposal/route.ts` (`can_handle_requests`)
- Modify: `src/app/api/appointments/[appointmentId]/cancel/route.ts` (`can_edit_bookings`, multi-role +homeowner)
- Modify: `src/app/api/appointments/[appointmentId]/lifecycle/route.ts` (`can_edit_bookings`, multi-role +cleaner)
- Modify: `src/app/api/appointments/notify-reschedule/route.ts` (`can_edit_bookings`, staff-only)
- Test: co-located `*.integration.test.ts` for each (create/extend)

**Interfaces:**
- Consumes: `requireManagerPermission` from `@/lib/auth/requireManagerPermission`.

- [ ] **Step 1: Staff-only routes — swap the auth call**

For `recurring-appointments` POST, `accept-counter-proposal`, and `notify-reschedule` (all `allowedRoles: ['owner','admin','manager']`), replace the `requireOrgAuth(request, organizationId, supabaseAdmin, { allowedRoles: ['owner','admin','manager'] })` call with `requireManagerPermission(request, organizationId, supabaseAdmin, <flag>)` where `<flag>` is `'can_edit_bookings'` for recurring-POST and notify-reschedule, and `'can_handle_requests'` for accept-counter-proposal. Add `import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';`. For `recurring-appointments` GET, insert (after its `if (!auth.ok) return auth.response;`) a swap to `requireManagerPermission(..., 'can_view_bookings')` (it is a PII read).

- [ ] **Step 2: Multi-role routes — keep the role list, add the flag**

For `cancel` (allowedRoles includes `'homeowner'`) and `lifecycle` (allowedRoles includes `'cleaner'`), do NOT drop those roles. Replace `requireOrgAuth(request, <orgVar>, supabaseAdmin, { allowedRoles: [<existing list>] })` with `requireManagerPermission(request, <orgVar>, supabaseAdmin, 'can_edit_bookings', { allowedRoles: [<the same existing list>] })`. Because the guard only checks the flag when `auth.role === 'manager'`, the homeowner/cleaner ownership branches (cancel:83-94, lifecycle:58-64) are untouched. **Note:** `cancel/route.ts` uses the snake_case var `organization_id`; the others use `organizationId` — use the correct one.

- [ ] **Step 3: Write the integration tests**

For each route, assert: manager without the governing flag → 403; manager with it → past-auth (not 401/403); and for the multi-role routes, a homeowner/cleaner is NOT blocked by the new gate. Model — `src/app/api/appointments/[appointmentId]/cancel/route.integration.test.ts` (add cases):

```ts
it('403 for a manager without can_edit_bookings', async () => {
  org = await withTestOrg();
  mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
  const res = await callRoute(POST, {
    method: 'POST',
    headers: bearerHeader(mgr.accessToken),
    body: { organization_id: org.organizationId, /* ...minimal required fields... */ },
  });
  expect(res.status).toBe(403);
});

it('does NOT block a homeowner (they use their own branch)', async () => {
  org = await withTestOrg();
  const res = await callRoute(POST, {
    method: 'POST',
    headers: bearerHeader(org.homeowner.accessToken),
    body: { organization_id: org.organizationId, /* ...minimal required fields... */ },
  });
  expect(res.status).not.toBe(403);
});
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- recurring-appointments accept-counter-proposal cancel lifecycle notify-reschedule`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/recurring-appointments/route.ts src/app/api/appointments/accept-counter-proposal/route.ts "src/app/api/appointments/[appointmentId]/cancel/route.ts" "src/app/api/appointments/[appointmentId]/lifecycle/route.ts" src/app/api/appointments/notify-reschedule/route.ts src/app/api/recurring-appointments/route.integration.test.ts src/app/api/appointments/accept-counter-proposal/route.integration.test.ts "src/app/api/appointments/[appointmentId]/cancel/route.integration.test.ts" "src/app/api/appointments/[appointmentId]/lifecycle/route.integration.test.ts" src/app/api/appointments/notify-reschedule/route.integration.test.ts
git commit -m "feat(permissions): enforce booking flags on booking-mutation routes"
```

---

## Task 6: RLS enforcement for service_types + properties writes

**Files:**
- Create: `supabase/migrations/104_manager_flags_rls_services_properties.sql`
- Test: `src/app/api/_rls/manager-services-properties-rls.integration.test.ts` (RLS via `createUserClient`)

**Interfaces:**
- Produces: manager writes to `service_types` require `can_manage_services`; writes to `properties` require `can_edit_properties`. Owner/admin and the existing non-manager branches are unchanged.

- [ ] **Step 1: Write the migration**

```sql
-- 104_manager_flags_rls_services_properties.sql
--
-- Enforce the manager fine-grained flags that only ever lived in the UI: the LIVE
-- write policies (service_types from 076, properties from 074) let ANY org
-- owner/admin/manager write regardless of manager_permissions. Split the manager
-- branch out and gate it on the flag (can_manage_services / can_edit_properties),
-- mirroring the org+flag shape used for invoices/payouts in 075. Owner/admin and the
-- self-owner / user_profiles-admin branches are preserved verbatim.

-- ================= SERVICE_TYPES (writes) =================
DROP POLICY IF EXISTS "service_types_insert" ON public.service_types;
DROP POLICY IF EXISTS "service_types_update" ON public.service_types;
DROP POLICY IF EXISTS "service_types_delete" ON public.service_types;

CREATE POLICY "service_types_insert" ON public.service_types
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND (om.role = 'owner'::public.org_role OR om.role = 'admin'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON mp.manager_id = om.user_id AND mp.organization_id = om.organization_id WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = 'manager'::public.org_role AND mp.can_manage_services = true)
  );
CREATE POLICY "service_types_update" ON public.service_types
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND (om.role = 'owner'::public.org_role OR om.role = 'admin'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON mp.manager_id = om.user_id AND mp.organization_id = om.organization_id WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = 'manager'::public.org_role AND mp.can_manage_services = true)
  );
CREATE POLICY "service_types_delete" ON public.service_types
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND (om.role = 'owner'::public.org_role OR om.role = 'admin'::public.org_role))
    OR EXISTS (SELECT 1 FROM public.organization_members om JOIN public.manager_permissions mp ON mp.manager_id = om.user_id AND mp.organization_id = om.organization_id WHERE om.user_id = (select auth.uid()) AND om.organization_id = service_types.organization_id AND om.role = 'manager'::public.org_role AND mp.can_manage_services = true)
  );

-- ================= PROPERTIES (writes) =================
DROP POLICY IF EXISTS "properties_insert" ON public.properties;
DROP POLICY IF EXISTS "properties_update" ON public.properties;
DROP POLICY IF EXISTS "properties_delete" ON public.properties;

CREATE POLICY "properties_insert" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = owner_id
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]) AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer JOIN public.manager_permissions mp ON mp.manager_id = om_viewer.user_id AND mp.organization_id = om_viewer.organization_id WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = 'manager'::public.org_role AND mp.can_edit_properties = true AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
  );
CREATE POLICY "properties_update" ON public.properties
  FOR UPDATE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]) AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer JOIN public.manager_permissions mp ON mp.manager_id = om_viewer.user_id AND mp.organization_id = om_viewer.organization_id WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = 'manager'::public.org_role AND mp.can_edit_properties = true AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
    OR EXISTS (SELECT 1 FROM public.organization_members om_owner JOIN public.organization_members om_actor ON om_actor.organization_id = om_owner.organization_id WHERE om_owner.user_id = properties.owner_id AND om_actor.user_id = (select auth.uid()) AND om_actor.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]))
    OR EXISTS (SELECT 1 FROM public.organization_members om_owner JOIN public.organization_members om_actor ON om_actor.organization_id = om_owner.organization_id JOIN public.manager_permissions mp ON mp.manager_id = om_actor.user_id AND mp.organization_id = om_actor.organization_id WHERE om_owner.user_id = properties.owner_id AND om_actor.user_id = (select auth.uid()) AND om_actor.role = 'manager'::public.org_role AND mp.can_edit_properties = true)
  );
CREATE POLICY "properties_delete" ON public.properties
  FOR DELETE TO authenticated
  USING (
    (select auth.uid()) = owner_id
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role]) AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.organization_members om_viewer JOIN public.manager_permissions mp ON mp.manager_id = om_viewer.user_id AND mp.organization_id = om_viewer.organization_id WHERE om_viewer.user_id = (select auth.uid()) AND om_viewer.role = 'manager'::public.org_role AND mp.can_edit_properties = true AND EXISTS (SELECT 1 FROM public.organization_members om_target WHERE om_target.user_id = properties.owner_id AND om_target.role = 'homeowner'::public.org_role AND om_target.organization_id = om_viewer.organization_id))
    OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = (select auth.uid()) AND up.role = 'admin'::public.user_role)
  );
```

- [ ] **Step 2: Rebuild schema**

Run: `npx supabase db reset`
Expected: no error.

- [ ] **Step 3: Write the RLS integration test**

Create `src/app/api/_rls/manager-services-properties-rls.integration.test.ts` using `createUserClient(token)` (runs under RLS). Seed an org + a service_type (via admin client), then attempt an UPDATE as a manager under RLS: with `can_manage_services:false` the update affects 0 rows (or errors), with `true` it succeeds. Model:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createTestSupabaseClient, createUserClient } from '../../../../tests/helpers/supabase';
import { withTestOrg, addManagerToOrg } from '../../../../tests/helpers/fixtures';

const admin = createTestSupabaseClient();
let org: Awaited<ReturnType<typeof withTestOrg>> | null = null;
let mgr: Awaited<ReturnType<typeof addManagerToOrg>> | null = null;

afterEach(async () => {
  if (mgr) { await mgr.cleanup(); mgr = null; }
  if (org) { await org.cleanup(); org = null; }
});

async function seedService(orgId: string) {
  const { data, error } = await admin.from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60 })
    .select('id').single();
  if (error) throw error;
  return data.id as string;
}

describe('manager RLS: service_types write requires can_manage_services', () => {
  it('denies a manager without the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    const svcId = await seedService(org.organizationId);
    const db = createUserClient(mgr.accessToken);
    const { data } = await db.from('service_types').update({ name: 'Hacked' }).eq('id', svcId).select('id');
    expect(data ?? []).toHaveLength(0); // RLS blocked the row
  });

  it('allows a manager with the flag', async () => {
    org = await withTestOrg();
    mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    const svcId = await seedService(org.organizationId);
    const db = createUserClient(mgr.accessToken);
    const { data } = await db.from('service_types').update({ name: 'OK' }).eq('id', svcId).select('id');
    expect(data ?? []).toHaveLength(1);
  });
});
```

Add an analogous pair for `properties` + `can_edit_properties` (seed a homeowner-owned property in the org via the admin client; confirm `createTestAppointment(... orgOwnedProperty)` or a direct `properties` insert to get a property id).

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- manager-services-properties-rls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/104_manager_flags_rls_services_properties.sql src/app/api/_rls/manager-services-properties-rls.integration.test.ts
git commit -m "feat(permissions): RLS enforcement for can_manage_services + can_edit_properties"
```

---

## Task 7: Invite-carried permissions + delete the all-true seed

**Files:**
- Create: `supabase/migrations/105_invites_manager_permissions.sql`
- Modify: `src/app/api/admin/send-invite/route.ts` (accept + persist `permissions`)
- Modify: `src/app/api/accept-invite/route.ts` (read invite `manager_permissions`, persist it; replace all-true seed)
- Modify: `src/hooks/useAdminData.ts` (`inviteTeamMember` carries `permissions`)
- Test: extend `src/app/api/admin/send-invite/route.integration.test.ts`; add an accept-invite persistence test.

**Interfaces:**
- Consumes: `STANDARD_MANAGER_PRESET`, `coerceManagerPermissions`, `MANAGER_FLAG_KEYS` from `@/lib/permissions/managerFlags`.
- Produces: `invites.manager_permissions jsonb`; `send-invite` body accepts optional `permissions: ManagerPermissions`; `accept-invite` seeds exactly those.

- [ ] **Step 1: Migration — add the jsonb column**

```sql
-- 105_invites_manager_permissions.sql
--
-- Carry a manager's chosen fine-grained permissions on the invite so acceptance
-- persists exactly what the inviter selected (defaulting to the Standard manager
-- preset in the app), replacing the old accept-invite behavior of seeding every
-- flag true. NULL = "use the app default preset" for non-manager or legacy invites.

ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS manager_permissions jsonb;

COMMENT ON COLUMN public.invites.manager_permissions IS
  'Chosen manager_permissions flags for a manager invite (jsonb map of flag->bool); NULL for non-manager invites.';
```

Run: `npx supabase db reset` → no error.

- [ ] **Step 2: `send-invite` — accept + persist permissions**

Destructure `permissions` from the body (line ~6-8). After the role ceiling passes, compute the value to store: only for `role === 'manager'`, sanitize the incoming object to the known keys (`coerceManagerPermissions(permissions)`); otherwise `null`. Add `manager_permissions: role === 'manager' ? coerceManagerPermissions(permissions) : null` to the invite insert object (line ~237-259). Import from `@/lib/permissions/managerFlags`.

- [ ] **Step 3: `accept-invite` — read + persist**

Add `manager_permissions` to the invite `.select(...)` (line ~52). Replace the hardcoded 14-true seeding object (lines ~203-234) with:

```ts
const seededPerms = invite.manager_permissions
  ? coerceManagerPermissions(invite.manager_permissions as Record<string, unknown>)
  : STANDARD_MANAGER_PRESET;
const { error: permError } = await supabaseAdmin
  .from('manager_permissions')
  .upsert(
    { manager_id: verified.userId, organization_id: invite.organization_id, ...seededPerms },
    { onConflict: 'manager_id,organization_id' },
  );
```

(Keep the surrounding error handling exactly as before.)

- [ ] **Step 4: Client — carry permissions through `inviteTeamMember`**

In `src/hooks/useAdminData.ts` (`inviteTeamMember`, ~line 2216), add an optional `permissions?: ManagerPermissions` to the `data` param and include it in the POST body.

- [ ] **Step 5: Tests**

Extend `send-invite/route.integration.test.ts`: sending a manager invite with `permissions: { ...preset, can_manage_payments: true }` stores that jsonb on the invite row (re-read with admin client). Add `src/app/api/accept-invite/route.integration.test.ts` asserting that after acceptance the `manager_permissions` row equals the invite's chosen set (and, when the invite's `manager_permissions` is null, equals `STANDARD_MANAGER_PRESET` — importantly NOT all-true).

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test:integration -- send-invite accept-invite`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/105_invites_manager_permissions.sql src/app/api/admin/send-invite/route.ts src/app/api/accept-invite/route.ts src/hooks/useAdminData.ts src/app/api/admin/send-invite/route.integration.test.ts src/app/api/accept-invite/route.integration.test.ts
git commit -m "feat(permissions): invites carry chosen manager permissions; drop all-true seed"
```

---

## Task 8: Collapse client duplication onto the registry

**Files:**
- Modify: `src/hooks/useAdminData.ts` (re-export `ManagerPermissions` from the registry; derive `STAFF_PERMISSION_KEYS`, the `useAdminTeamMembers` `.select()` + mapping from `MANAGER_FLAG_KEYS` / `coerceManagerPermissions`)
- Modify: `src/hooks/useManagerPermissions.ts` (derive `ALL_FALSE`, `.select()`, mapping from the registry)

**Interfaces:**
- Consumes: `MANAGER_FLAG_KEYS`, `MANAGER_FLAG_SELECT`, `coerceManagerPermissions`, `emptyManagerPermissions`, `type ManagerPermissions` from `@/lib/permissions/managerFlags`.

- [ ] **Step 1: Re-export the type (keep the ~10 existing import sites working)**

In `src/hooks/useAdminData.ts`, delete the local `interface ManagerPermissions { ... }` (lines ~1973-1989) and add near the top: `export type { ManagerPermissions } from '@/lib/permissions/managerFlags';`. Existing `import { ManagerPermissions } from './useAdminData'` sites keep compiling.

- [ ] **Step 2: Derive the `useAdminData` duplications**

- Replace `STAFF_PERMISSION_KEYS` (lines ~2570-2586) with `import { MANAGER_FLAG_KEYS as STAFF_PERMISSION_KEYS } from '@/lib/permissions/managerFlags';` (or use `MANAGER_FLAG_KEYS` directly at the two `useAdminStaff` call sites 2633/2638).
- In `useAdminTeamMembers`, replace the hard-coded `.select('...15 columns...')` (line ~2042) with `.select(MANAGER_FLAG_SELECT)` and the manual mapping object (~2065-2079) with `coerceManagerPermissions(permissions)`.

- [ ] **Step 3: Derive `useManagerPermissions`**

Rewrite the three duplicated spots to use the registry:
- Replace the `ALL_FALSE` literal (10-26) with `const ALL_FALSE = emptyManagerPermissions();`
- Replace the `.select('...columns...')` (line 40) with `.select(MANAGER_FLAG_SELECT)`.
- Replace the manual `Boolean(...)` mapping (52-68) with `return coerceManagerPermissions(data);`.
Import the helpers from `@/lib/permissions/managerFlags`.

- [ ] **Step 4: Typecheck + run affected tests**

Run: `npx tsc --noEmit`
Expected: clean (the ManagerPermissions type now has 14 keys everywhere).
Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAdminData.ts src/hooks/useManagerPermissions.ts
git commit -m "refactor(permissions): derive client flag lists from the registry"
```

---

## Task 9: Unify the two editors + collapsible invite editor

**Files:**
- Create: `src/components/settings/ManagerPermissionEditor.tsx` (shared, registry-driven grouped toggle list)
- Modify: `src/components/settings/ManagerPermissionsForm.tsx` (render via the shared editor)
- Modify: `src/components/redesign/cleaners/StaffDetailSheet.tsx` (render via the shared editor; keep its `PERMISSION_KEYS` re-export sourced from `MANAGER_FLAG_KEYS`)
- Modify: `src/components/AddTeamMemberModal.tsx` (collapsible preset editor when `role === 'manager'`)

**Interfaces:**
- Consumes: `MANAGER_FLAGS`, `MANAGER_FLAG_GROUPS`, `STANDARD_MANAGER_PRESET`, `type ManagerPermissions` from `@/lib/permissions/managerFlags`.
- Produces: `ManagerPermissionEditor({ value, onChange, disabled? }: { value: ManagerPermissions; onChange: (next: ManagerPermissions) => void; disabled?: boolean })` — renders `MANAGER_FLAGS` grouped by `group` as toggle rows, built from the design system (`src/components/ui/*`).

- [ ] **Step 1: Build the shared editor**

Create `ManagerPermissionEditor.tsx` mapping `MANAGER_FLAG_GROUPS` → for each group render its `MANAGER_FLAGS.filter(f => f.group === group)` as rows with a `Switch` (from `@/components/ui/switch`) bound to `value[flag.key]`, calling `onChange({ ...value, [key]: next })`. Use design-system primitives + tokens ONLY (no raw hex). Group headers use the existing label/section styles used elsewhere in settings.

- [ ] **Step 2: Point both existing editors at it**

- `ManagerPermissionsForm.tsx`: replace its local `PERMISSION_GROUPS` + checkbox JSX with `<ManagerPermissionEditor value={permissions} onChange={setPermissions} />`; keep its save() → `updateManagerPermissions`. Delete the local `ALL_FALSE` literal (use `emptyManagerPermissions()` for initial state, then hydrate from `manager`).
- `StaffDetailSheet.tsx`: replace its local `PERMISSION_GROUPS` + `<Switch>` map with `<ManagerPermissionEditor .../>`; change the re-export at line ~228 to `export { MANAGER_FLAG_KEYS as PERMISSION_KEYS } from '@/lib/permissions/managerFlags';` (preserve the public surface). Owner/admin still get the "not restricted" fallback message.

- [ ] **Step 3: Collapsible invite editor**

In `AddTeamMemberModal.tsx`, add permission state initialized to `STANDARD_MANAGER_PRESET`. Immediately after the role-picker JSX (`</div>` around line 311), when `role === 'manager'`, render a collapsed summary row ("Using the Standard manager preset. Customize") with a toggle that expands `<ManagerPermissionEditor value={perms} onChange={setPerms} />`. Pass `perms` into the `inviteTeamMember({ ..., permissions: role === 'manager' ? perms : undefined })` call.

- [ ] **Step 4: Verify build + visuals**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.
Run the app (`npm run dev`) and, per the `ui-feature-workflow` + `ui-ux-pro-max` implementation-phase check, confirm the editor and the invite disclosure render from design-system primitives (no raw hex / off-system styling). Screenshot the invite modal (collapsed + expanded) and the Settings → Team editor.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ManagerPermissionEditor.tsx src/components/settings/ManagerPermissionsForm.tsx src/components/redesign/cleaners/StaffDetailSheet.tsx src/components/AddTeamMemberModal.tsx
git commit -m "feat(permissions): single registry-driven manager-permission editor + collapsible invite editor"
```

---

## Final gate (whole plan)

- [ ] `npm run test` green.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run lint` clean.
- [ ] `npx supabase db reset` rebuilds cleanly with migrations 103/104/105.
- [ ] Manual sanity: a manager with all flags off gets 403 from every guarded route and 0-row RLS writes; a newly accepted invite has the chosen/preset permissions (not all-true).

## Self-Review

- **Spec coverage:** Part A → Tasks 1, 8, 9. Part B (guard + routes + RLS + PII reads) → Tasks 2, 4, 5, 6. Part C (default posture) → Tasks 7, 9. Part E (migrations) → Tasks 3, 6, 7. Part F (tests) → per-task integration/unit tests. Part D (UI fold-in) → separate plan `2026-07-08-manager-operator-foldin.md`.
- **Type consistency:** `ManagerPermissionKey`, `ManagerPermissions`, `MANAGER_FLAG_KEYS`, `MANAGER_FLAG_SELECT`, `coerceManagerPermissions`, `emptyManagerPermissions`, `STANDARD_MANAGER_PRESET`, `requireManagerPermission` names are used identically across tasks.
- **Known confirm-at-impl items:** the exact minimal required body fields for each route's 403 test (read the route's destructure); the `recurring-appointments` GET view flag (`can_view_bookings` chosen; `can_view_customers` also defensible); exact `properties` seed path in the RLS test (use a direct `properties` insert with a homeowner `owner_id`).
