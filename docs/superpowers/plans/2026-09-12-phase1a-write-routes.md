# Phase 1a: Route the Freeze-Relevant Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every browser write that creates new work (services, checklists, the operator's one-off booking, the homeowner's add-home) behind authenticated API routes, so the Phase 1b billing guard has exactly one seam to enforce.

**Architecture:** Three stacked PRs (A services, B checklists, C booking and property). Every new route resolves the org server-side from the target row (never from a body field alone), authorizes with the existing `requireOrgAuth` / `requireManagerPermission` helpers, writes with `supabaseAdmin`, and returns the created or updated row. Client hook functions keep their exported names and (with two noted exceptions) their signatures, and delegate to thin fetch wrappers, so the pages that call them do not change. Reads stay as direct supabase-js calls under RLS.

**Tech Stack:** Next.js 16 App Router route handlers (`runtime = 'nodejs'`), Supabase (supabase-js; service role on the server via `@/lib/supabase-admin`), TanStack Query v5 hooks, Vitest (unit project for pure parsers, integration project against local Supabase), `tests/helpers/{auth,fixtures,supabase}.ts`.

**Spec:** `docs/superpowers/specs/2026-09-08-saas-billing-design.md`, sections 4 (scope split), 12 (route design), 19 (testing), 20 (PR order and build model), 22 item 1 (manager permission key, resolved below).

**Build model (spec §20):** every task in this plan is mechanical, so the default executor is a **Sonnet** subagent. Fable (the main session) reviews each task's diff and test output, and reviews each PR before it is pushed. Executors do not make design decisions; anything not covered here goes back to Fable as a question.

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements include this section.

- **Branch and PR flow.** One feature branch per PR, off current `origin/master`: `feat/phase1a-services-routes` (A), `feat/phase1a-checklist-routes` (B, branched off A), `feat/phase1a-booking-property-routes` (C, branched off B). B and C depend on A's shared helpers, so link them with `gh stack init <A> <B> <C>` and `gh stack submit`; merge bottom-up, one layer at a time, with `gh stack merge --yes --squash <pr#>`, waiting for the auto-rebased next layer's checks between merges (about 15 minutes each). Never push to `master`. Squash merges only.
- **Local `master` is checked out in a worktree** (`.claude/worktrees/pay-request-model`), so `git checkout master` fails. Branch from `origin/master` directly: `git fetch origin && git checkout -b <branch> origin/master`.
- **No migrations in Phase 1a.** RLS stays exactly as it is; the routes use the service role and enforce the same rules in code.
- **Route conventions.** `export const runtime = 'nodejs'`; import `supabaseAdmin` from `@/lib/supabase-admin`; authorize against the org resolved from the target row; JSON bodies `{ success: true, data }` on success and `{ error: string }` on failure; status 201 for creates, 200 for updates and deletes; 400 for a bad body, 401 no token, 403 wrong org or role or missing flag, 404 unknown id, 409 a conflict the user can act on, 500 a database error (message passed through).
- **Manager permission keys (resolves spec §22 item 1).** Migration 104 already gates manager writes in RLS: `service_types` on `can_manage_services`, `properties` on `can_edit_properties`. Checklists and line items have no flag of their own in RLS (migration 076 lets any org owner/admin/manager write), but they are part of the service catalog and the services page already hides them behind `can_manage_services`, so the checklist routes use `can_manage_services`. Bookings use `can_edit_bookings` (the same key `POST /api/recurring-appointments` uses). Owner and admin always pass; a manager passes only with the flag; every other role gets 403.
- **Client calls** go through `apiFetch` (Task 1), which attaches the Supabase access token from `getAccessToken()` and returns `{ success, data }` or `{ success: false, error, status }`. Never import `@/lib/supabase-admin` from client code.
- **Hook signatures are frozen** except `updateService` and `toggleServiceActive`, which lose their trailing `organizationId` argument (Task 6 updates their two call sites). `src/components/redesign/services/OperatorServices.tsx` otherwise does not change; neither do `DeleteServiceDialog.tsx`, `ServiceDetailHandlers`, or any child component.
- **Tests.** Every new route gets a co-located `route.integration.test.ts` using `callRoute`, `bearerHeader`, `withTestOrg`, `addManagerToOrg`, `createTestSupabaseClient`. Every new pure module under `src/lib/**` gets a co-located `*.test.ts`. Integration tests need `npx supabase start` running and `.env.test.local` filled from `npx supabase status --output json`. Run one file with `npm run test:integration -- <path>`; the integration project retries flaky files twice, so a genuine failure fails three times.
- **Gates before every push:** `npm run test`, `npx tsc --noEmit` (no errors you introduced; pre-existing ones remain), `npm run lint`. The full local suite can show unrelated failures while other sessions share the local Supabase; run the targeted files and let CI arbitrate.
- **Copy rules.** No em dashes (the `—` character) in any user-facing string: error messages, toasts, labels. Use a period, comma, parentheses, or "to".
- **Commit trailer.** End every commit message with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
  ```
- **Never** commit `.env*.local` or `.claude/settings.local.json`; never `new Stripe()`; never touch `supabase/migrations/`.

## Decisions made while planning (Fable, 2026-09-12)

1. **Line-item routes are `/api/checklist-items/[itemId]`** (PATCH, DELETE), not the spec's `/api/checklists/[id]/items/[itemId]`. The hook functions `updateLineItem(lineItemId, task)` and `deleteLineItem(lineItemId)` only know the item id, and threading a checklist id through would change `ServiceDetailHandlers` and three child components. The route resolves the org from the item itself. Spec §12.2 is amended to match.
2. **Bulk-added items keep `position = null`**, exactly as the client did. The existing sort places null positions last by `created_at`, so they read as appended. Assigning numeric positions would jump new items above the trigger-seeded default items, which still have null positions.
3. **`POST /api/services` treats `checklists` three ways:** absent keeps the trigger-seeded "Default Checklist" (today's create); an array, even empty, deletes the seeded checklist and creates the given ones (today's duplicate). A seed failure deletes the service again.
4. **`POST /api/appointments` recomputes `response_deadline` server-side** and forces `status: 'pending'` and `cleaner_confirmation_status: 'awaiting'`; the client's copies of those fields are ignored. `total_price` is still trusted from the client (parity with the direct insert and with `/api/recurring-appointments`); server-side price recomputation is a follow-up for the billing plan, not this one.
5. **The property route only supports what has a caller today:** a homeowner adding their own home (owner forced to the caller) and an operator adding a home for a homeowner member (owner must be a homeowner of the org). Org-owned properties (`owner_id = null`) have no client caller yet and are out of scope.

## File map

**Shared (created in PR A, extended in B and C)**

| File | Responsibility |
|---|---|
| `src/lib/auth/apiFetch.ts` | Client-side authenticated fetch that never throws; one place that knows the `{ success, data } / { error }` envelope. |
| `src/lib/catalog/parse.ts` | Tiny pure parsing primitives shared by every route body parser: `ParseResult`, `asRecord`, `isUuid`, `parseMoney`, `parseRequiredText`, `parseOptionalText`. |
| `src/lib/catalog/resolveCatalogOrg.ts` | Server-side "which org owns this service / checklist / line item" lookups. |
| `src/lib/catalog/authorizeCatalog.ts` | `authorizeService` / `authorizeChecklist` / `authorizeLineItem`: resolve the org, then run the `can_manage_services` check against it. |

**PR A: services**

| File | Responsibility |
|---|---|
| `src/lib/catalog/serviceInput.ts` (+ `.test.ts`) | `parseServiceCreate`, `parseServiceUpdate`, `parseChecklistSeeds`. |
| `src/app/api/services/route.ts` (+ `.integration.test.ts`) | `POST` create service, optional checklist seeds. |
| `src/app/api/services/[id]/route.ts` (+ test) | `PATCH` partial update, `DELETE` with in-use checks. |
| `src/hooks/services-api.ts` | `createServiceApi`, `updateServiceApi`, `deleteServiceApi`. |
| `src/hooks/useServices.ts` (modify) | `createService`, `updateService`, `deleteService`, `duplicateService` call the API; `toggleServiceActive` signature follows; reads and cache helpers unchanged. |
| `src/components/redesign/services/OperatorServices.tsx` (modify 2 lines) | Drop the third argument from `updateService` and `toggleServiceActive` calls. |

**PR B: checklists**

| File | Responsibility |
|---|---|
| `src/lib/catalog/checklistInput.ts` (+ `.test.ts`) | `parseChecklistCreate`, `parseChecklistUpdate`, `parseItemsCreate`, `parseItemUpdate`, `parseOrder`, `orderMatchesItems`. |
| `src/lib/catalog/resolveCatalogOrg.ts` (modify) | Add `resolveChecklistOrg`, `resolveLineItemOrg`. |
| `src/app/api/services/[id]/checklists/route.ts` (+ test) | `POST` create checklist with items. |
| `src/app/api/checklists/[id]/route.ts` (+ test) | `PATCH`, `DELETE` checklist. |
| `src/app/api/checklists/[id]/items/route.ts` (+ test) | `POST` one task or many. |
| `src/app/api/checklists/[id]/items/order/route.ts` (+ test) | `PUT` reorder. |
| `src/app/api/checklist-items/[itemId]/route.ts` (+ test) | `PATCH`, `DELETE` one line item. |
| `src/hooks/checklists-api.ts` | Fetch wrappers for the six routes. |
| `src/hooks/useChecklists.ts` (modify) | The nine write functions call the API; hook body and cache helpers unchanged. |

**PR C: booking and property**

| File | Responsibility |
|---|---|
| `src/lib/payments/isCleanerPayable.ts` (modify) | Gains `selfPayCleanerBlockReason` (moved from the component folder so the route can import it). |
| `src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts` (modify) | Re-exports `selfPayCleanerBlockReason` from lib; its existing unit test keeps passing. |
| `src/lib/appointments/parseOperatorBooking.ts` (+ `.test.ts`) | `parseOperatorBookingBody`, `isYMD`, `isHMM`. |
| `src/app/api/appointments/route.ts` (+ test) | `POST` operator one-off booking. |
| `src/components/redesign/bookings/new-booking/bookings-api.ts` | `createBookingApi`. |
| `src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts` (modify) | One-off branch calls the API. |
| `src/lib/properties/parsePropertyInput.ts` (+ `.test.ts`) | `parsePropertyCreate`. |
| `src/app/api/properties/route.ts` (+ test) | `POST` add home. |
| `src/components/redesign/homeowner/account/properties/properties-api.ts` | `createPropertyApi`. |
| `src/components/redesign/homeowner/account/properties/PropertyFormSheet.tsx` (modify) | Insert branch calls the API; drop the now-unused `supabase` import. |

---

# PR A: services (`feat/phase1a-services-routes`)

Start: `git fetch origin && git checkout -b feat/phase1a-services-routes origin/master`.

### Task 1: `apiFetch` client helper

**Files:**
- Create: `src/lib/auth/apiFetch.ts`
- Test: `src/lib/auth/apiFetch.test.ts`

**Interfaces:**
- Consumes: `getAccessToken(): Promise<string | null>` from `@/lib/auth/clientAccessToken` (exists).
- Produces: `apiFetch<T>(path: string, init: { method; body? }): Promise<ApiResult<T>>` and `type ApiResult<T> = { success: true; data: T } | { success: false; error: string; status: number }`. Every `*-api.ts` module in this plan calls it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/apiFetch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth/clientAccessToken', () => ({ getAccessToken: vi.fn() }));

import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { apiFetch } from './apiFetch';

const token = vi.mocked(getAccessToken);
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    token.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a 401 result without calling fetch when there is no session', async () => {
    token.mockResolvedValue(null);
    const res = await apiFetch('/api/services', { method: 'POST', body: { a: 1 } });
    expect(res).toEqual({
      success: false,
      error: 'You are signed out. Please sign in again.',
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bearer token and JSON body and returns data on success', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(201, { success: true, data: { id: 'svc_1' } }));
    const res = await apiFetch<{ id: string }>('/api/services', { method: 'POST', body: { name: 'x' } });
    expect(res).toEqual({ success: true, data: { id: 'svc_1' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_123' },
      body: JSON.stringify({ name: 'x' }),
    });
  });

  it('omits the body for a DELETE with no body', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));
    const res = await apiFetch<void>('/api/services/abc', { method: 'DELETE' });
    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE', body: undefined });
  });

  it('surfaces the route error and status on a non-2xx response', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Requires the Manage services permission' }));
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({
      success: false,
      error: 'Requires the Manage services permission',
      status: 403,
    });
  });

  it('treats a 200 without success:true as a failure with a generic message', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({
      success: false,
      error: 'Something went wrong. Please try again.',
      status: 200,
    });
  });

  it('returns a network error result when fetch throws', async () => {
    token.mockResolvedValue('tok_123');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await apiFetch('/api/services', { method: 'POST', body: {} });
    expect(res).toEqual({
      success: false,
      error: 'Network error. Check your connection and try again.',
      status: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- src/lib/auth/apiFetch.test.ts`
Expected: FAIL, "Failed to resolve import './apiFetch'".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/auth/apiFetch.ts
import { getAccessToken } from '@/lib/auth/clientAccessToken';

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };

export interface ApiFetchInit {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
}

/**
 * Client -> API route call with the Supabase access token attached.
 *
 * Never throws. A missing session, a network failure, a non-2xx status, and a
 * response that is not `{ success: true }` all come back as `{ success: false }`
 * with the route's `error` message when there is one, so hook functions can
 * return the same `{ success, error }` shape the pages already handle.
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit): Promise<ApiResult<T>> {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, error: 'You are signed out. Please sign in again.', status: 401 };
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.', status: 0 };
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: string }
    | null;

  if (!res.ok || !json || json.success !== true) {
    return {
      success: false,
      error: json?.error || 'Something went wrong. Please try again.',
      status: res.status,
    };
  }
  return { success: true, data: json.data as T };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- src/lib/auth/apiFetch.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/apiFetch.ts src/lib/auth/apiFetch.test.ts
git commit -m "feat(api): apiFetch client helper for authenticated route calls

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 2: parsing primitives and the service body parsers

**Files:**
- Create: `src/lib/catalog/parse.ts`
- Create: `src/lib/catalog/serviceInput.ts`
- Test: `src/lib/catalog/parse.test.ts`, `src/lib/catalog/serviceInput.test.ts`

**Interfaces:**
- Produces (parse.ts): `ParseResult<T>`, `asRecord(body: unknown): Record<string, unknown> | null`, `isUuid(v: unknown): v is string`, `parseMoney(v: unknown, label: string): ParseResult<number>`, `parseRequiredText(v: unknown, label: string, max: number): ParseResult<string>`, `parseOptionalText(v: unknown, label: string): ParseResult<string | null>`.
- Produces (serviceInput.ts): `ChecklistSeed`, `ServiceCreateInput`, `ServiceUpdateInput`, `parseChecklistSeeds(v: unknown)`, `parseServiceCreate(body: unknown)`, `parseServiceUpdate(body: unknown)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/catalog/parse.test.ts
import { describe, it, expect } from 'vitest';
import { asRecord, isUuid, parseMoney, parseOptionalText, parseRequiredText } from './parse';

describe('asRecord', () => {
  it('accepts plain objects only', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toBeNull();
    expect(asRecord([1])).toBeNull();
    expect(asRecord('x')).toBeNull();
  });
});

describe('isUuid', () => {
  it('matches lowercase and uppercase v4-shaped ids', () => {
    expect(isUuid('5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9')).toBe(true);
    expect(isUuid('5F3A2B1C-9D8E-4F7A-B6C5-D4E3F2A1B0C9')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isUuid('svc_1')).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('parseMoney', () => {
  it('accepts numbers and numeric strings, rounds to cents', () => {
    expect(parseMoney(199.999, 'Base price')).toEqual({ ok: true, value: 200 });
    expect(parseMoney('42.5', 'Base price')).toEqual({ ok: true, value: 42.5 });
    expect(parseMoney(0, 'Base price')).toEqual({ ok: true, value: 0 });
  });
  it('rejects negatives, NaN, and non-numbers with the label', () => {
    const err = { ok: false, error: 'Base price must be a number of 0 or more' };
    expect(parseMoney(-1, 'Base price')).toEqual(err);
    expect(parseMoney('abc', 'Base price')).toEqual(err);
    expect(parseMoney(null, 'Base price')).toEqual(err);
  });
});

describe('parseRequiredText', () => {
  it('trims and enforces the max length', () => {
    expect(parseRequiredText('  Deep Clean ', 'Service name', 120)).toEqual({ ok: true, value: 'Deep Clean' });
    expect(parseRequiredText('   ', 'Service name', 120)).toEqual({ ok: false, error: 'Service name is required' });
    expect(parseRequiredText('x'.repeat(121), 'Service name', 120)).toEqual({
      ok: false,
      error: 'Service name must be 120 characters or fewer',
    });
    expect(parseRequiredText(7, 'Service name', 120)).toEqual({ ok: false, error: 'Service name is required' });
  });
});

describe('parseOptionalText', () => {
  it('maps absent, null, and blank to null and trims text', () => {
    expect(parseOptionalText(undefined, 'Description')).toEqual({ ok: true, value: null });
    expect(parseOptionalText(null, 'Description')).toEqual({ ok: true, value: null });
    expect(parseOptionalText('   ', 'Description')).toEqual({ ok: true, value: null });
    expect(parseOptionalText(' hi ', 'Description')).toEqual({ ok: true, value: 'hi' });
    expect(parseOptionalText(5, 'Description')).toEqual({ ok: false, error: 'Description must be text' });
  });
});
```

```ts
// src/lib/catalog/serviceInput.test.ts
import { describe, it, expect } from 'vitest';
import { parseChecklistSeeds, parseServiceCreate, parseServiceUpdate } from './serviceInput';

const ORG = '5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
const valid = {
  organization_id: ORG,
  name: ' Deep Clean ',
  description: ' Top to bottom ',
  base_price: '199.5',
  duration_minutes: 180,
  service_type: 'deep',
};

describe('parseServiceCreate', () => {
  it('normalizes a valid body and defaults is_active to true', () => {
    expect(parseServiceCreate(valid)).toEqual({
      ok: true,
      value: {
        organization_id: ORG,
        name: 'Deep Clean',
        description: 'Top to bottom',
        base_price: 199.5,
        duration_minutes: 180,
        service_type: 'deep',
        is_active: true,
      },
    });
  });

  it('leaves checklists undefined when the key is absent', () => {
    const r = parseServiceCreate(valid);
    expect(r.ok && 'checklists' in r.value).toBe(false);
  });

  it('keeps an empty checklists array as an empty array', () => {
    const r = parseServiceCreate({ ...valid, checklists: [] });
    expect(r).toMatchObject({ ok: true, value: { checklists: [] } });
  });

  it('rejects a missing org id, blank name, bad price, bad duration, bad type, bad is_active', () => {
    expect(parseServiceCreate({ ...valid, organization_id: 'nope' })).toEqual({ ok: false, error: 'organization_id is required' });
    expect(parseServiceCreate({ ...valid, name: '' })).toEqual({ ok: false, error: 'Service name is required' });
    expect(parseServiceCreate({ ...valid, base_price: -5 })).toEqual({ ok: false, error: 'Base price must be a number of 0 or more' });
    expect(parseServiceCreate({ ...valid, duration_minutes: 0 })).toEqual({ ok: false, error: 'Duration must be a whole number of minutes greater than 0' });
    expect(parseServiceCreate({ ...valid, duration_minutes: 90.5 })).toEqual({ ok: false, error: 'Duration must be a whole number of minutes greater than 0' });
    expect(parseServiceCreate({ ...valid, service_type: '' })).toEqual({ ok: false, error: 'Service type is required' });
    expect(parseServiceCreate({ ...valid, is_active: 'yes' })).toEqual({ ok: false, error: 'is_active must be true or false' });
    expect(parseServiceCreate(null)).toEqual({ ok: false, error: 'Request body must be a JSON object' });
  });
});

describe('parseChecklistSeeds', () => {
  it('trims tasks, drops blank tasks, defaults name and price and position', () => {
    expect(parseChecklistSeeds([{ items: [' Dust ', '', 'Vacuum'] }])).toEqual({
      ok: true,
      value: [{ name: 'New Checklist', price_adder: 0, position: null, items: ['Dust', 'Vacuum'] }],
    });
  });
  it('keeps an explicit name, price and position', () => {
    expect(parseChecklistSeeds([{ name: ' Plus ', price_adder: '25', position: 1, items: [] }])).toEqual({
      ok: true,
      value: [{ name: 'Plus', price_adder: 25, position: 1, items: [] }],
    });
  });
  it('rejects a non-array, a non-object entry, a bad price, a bad position, and non-text items', () => {
    expect(parseChecklistSeeds({})).toEqual({ ok: false, error: 'checklists must be an array' });
    expect(parseChecklistSeeds(['x'])).toEqual({ ok: false, error: 'Each checklist must be an object' });
    expect(parseChecklistSeeds([{ price_adder: -1 }])).toEqual({ ok: false, error: 'Checklist price must be a number of 0 or more' });
    expect(parseChecklistSeeds([{ position: 1.5 }])).toEqual({ ok: false, error: 'Checklist position must be a whole number' });
    expect(parseChecklistSeeds([{ items: [1] }])).toEqual({ ok: false, error: 'Checklist items must be text' });
  });
});

describe('parseServiceUpdate', () => {
  it('accepts any subset of fields and normalizes them', () => {
    expect(parseServiceUpdate({ name: ' Basic ', is_active: false })).toEqual({
      ok: true,
      value: { name: 'Basic', is_active: false },
    });
    expect(parseServiceUpdate({ description: '' })).toEqual({ ok: true, value: { description: null } });
  });
  it('rejects an empty update and invalid values', () => {
    expect(parseServiceUpdate({})).toEqual({ ok: false, error: 'No valid fields to update' });
    expect(parseServiceUpdate({ unrelated: 1 })).toEqual({ ok: false, error: 'No valid fields to update' });
    expect(parseServiceUpdate({ name: '  ' })).toEqual({ ok: false, error: 'Service name is required' });
    expect(parseServiceUpdate({ base_price: 'x' })).toEqual({ ok: false, error: 'Base price must be a number of 0 or more' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- src/lib/catalog`
Expected: FAIL, both files cannot resolve their imports.

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/catalog/parse.ts
/**
 * Tiny pure parsing primitives for route bodies. Every route parser in
 * src/lib/catalog, src/lib/appointments and src/lib/properties builds on these
 * so error wording and normalization (trim, cents rounding) stay identical.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asRecord(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Non-negative dollar amount, numbers or numeric strings, rounded to cents. */
export function parseMoney(v: unknown, label: string): ParseResult<number> {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${label} must be a number of 0 or more` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function parseRequiredText(v: unknown, label: string, max: number): ParseResult<string> {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `${label} is required` };
  const text = v.trim();
  if (text.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer` };
  return { ok: true, value: text };
}

/** Absent, null, or blank become null; text is trimmed. */
export function parseOptionalText(v: unknown, label: string): ParseResult<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${label} must be text` };
  return { ok: true, value: v.trim() || null };
}
```

```ts
// src/lib/catalog/serviceInput.ts
import { asRecord, isUuid, parseMoney, parseOptionalText, parseRequiredText, type ParseResult } from './parse';

export const SERVICE_NAME_MAX = 120;

export interface ChecklistSeed {
  name: string;
  price_adder: number;
  position: number | null;
  items: string[];
}

export interface ServiceCreateInput {
  organization_id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
  service_type: string;
  is_active: boolean;
  /**
   * undefined: keep the trigger-seeded "Default Checklist" (plain create).
   * An array, even empty: replace the seeded checklist with these (duplicate).
   */
  checklists?: ChecklistSeed[];
}

export interface ServiceUpdateInput {
  name?: string;
  description?: string | null;
  base_price?: number;
  duration_minutes?: number;
  service_type?: string;
  is_active?: boolean;
}

function parseDuration(v: unknown): ParseResult<number> {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    return { ok: false, error: 'Duration must be a whole number of minutes greater than 0' };
  }
  return { ok: true, value: n };
}

function parseServiceType(v: unknown): ParseResult<string> {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: 'Service type is required' };
  return { ok: true, value: v.trim() };
}

function parseIsActive(v: unknown): ParseResult<boolean> {
  if (typeof v !== 'boolean') return { ok: false, error: 'is_active must be true or false' };
  return { ok: true, value: v };
}

export function parseChecklistSeeds(v: unknown): ParseResult<ChecklistSeed[]> {
  if (!Array.isArray(v)) return { ok: false, error: 'checklists must be an array' };
  const out: ChecklistSeed[] = [];
  for (const raw of v) {
    const r = asRecord(raw);
    if (!r) return { ok: false, error: 'Each checklist must be an object' };
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'New Checklist';
    const adder = parseMoney(r.price_adder ?? 0, 'Checklist price');
    if (!adder.ok) return adder;
    const position = r.position === undefined || r.position === null ? null : Number(r.position);
    if (position !== null && !Number.isInteger(position)) {
      return { ok: false, error: 'Checklist position must be a whole number' };
    }
    const itemsRaw = r.items ?? [];
    if (!Array.isArray(itemsRaw) || itemsRaw.some((t) => typeof t !== 'string')) {
      return { ok: false, error: 'Checklist items must be text' };
    }
    const items = (itemsRaw as string[]).map((t) => t.trim()).filter(Boolean);
    out.push({ name, price_adder: adder.value, position, items });
  }
  return { ok: true, value: out };
}

export function parseServiceCreate(body: unknown): ParseResult<ServiceCreateInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  if (!isUuid(r.organization_id)) return { ok: false, error: 'organization_id is required' };
  const name = parseRequiredText(r.name, 'Service name', SERVICE_NAME_MAX);
  if (!name.ok) return name;
  const description = parseOptionalText(r.description, 'Description');
  if (!description.ok) return description;
  const basePrice = parseMoney(r.base_price, 'Base price');
  if (!basePrice.ok) return basePrice;
  const duration = parseDuration(r.duration_minutes);
  if (!duration.ok) return duration;
  const serviceType = parseServiceType(r.service_type);
  if (!serviceType.ok) return serviceType;
  let isActive = true;
  if (r.is_active !== undefined) {
    const p = parseIsActive(r.is_active);
    if (!p.ok) return p;
    isActive = p.value;
  }
  const value: ServiceCreateInput = {
    organization_id: r.organization_id,
    name: name.value,
    description: description.value,
    base_price: basePrice.value,
    duration_minutes: duration.value,
    service_type: serviceType.value,
    is_active: isActive,
  };
  if (r.checklists !== undefined) {
    const seeds = parseChecklistSeeds(r.checklists);
    if (!seeds.ok) return seeds;
    value.checklists = seeds.value;
  }
  return { ok: true, value };
}

export function parseServiceUpdate(body: unknown): ParseResult<ServiceUpdateInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  const value: ServiceUpdateInput = {};
  if (r.name !== undefined) {
    const p = parseRequiredText(r.name, 'Service name', SERVICE_NAME_MAX);
    if (!p.ok) return p;
    value.name = p.value;
  }
  if (r.description !== undefined) {
    const p = parseOptionalText(r.description, 'Description');
    if (!p.ok) return p;
    value.description = p.value;
  }
  if (r.base_price !== undefined) {
    const p = parseMoney(r.base_price, 'Base price');
    if (!p.ok) return p;
    value.base_price = p.value;
  }
  if (r.duration_minutes !== undefined) {
    const p = parseDuration(r.duration_minutes);
    if (!p.ok) return p;
    value.duration_minutes = p.value;
  }
  if (r.service_type !== undefined) {
    const p = parseServiceType(r.service_type);
    if (!p.ok) return p;
    value.service_type = p.value;
  }
  if (r.is_active !== undefined) {
    const p = parseIsActive(r.is_active);
    if (!p.ok) return p;
    value.is_active = p.value;
  }
  if (Object.keys(value).length === 0) return { ok: false, error: 'No valid fields to update' };
  return { ok: true, value };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- src/lib/catalog`
Expected: all tests in both files pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/parse.ts src/lib/catalog/parse.test.ts src/lib/catalog/serviceInput.ts src/lib/catalog/serviceInput.test.ts
git commit -m "feat(services): pure body parsers for the service routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 3: `POST /api/services`

**Files:**
- Create: `src/app/api/services/route.ts`
- Test: `src/app/api/services/route.integration.test.ts`

**Interfaces:**
- Consumes: `parseServiceCreate`, `ChecklistSeed` (Task 2); `requireManagerPermission(request, orgId, supabaseAdmin, flag, { errorMessage })` from `@/lib/auth/requireManagerPermission` (exists); `supabaseAdmin` from `@/lib/supabase-admin` (exists).
- Produces: `POST /api/services` → `201 { success: true, data: ServiceType }`. Errors: `400 { error }` bad body, `401`, `403`, `500 { error }`.

Behavior: the `service_types` insert fires the database trigger `create_default_checklist_for_service`, which seeds a "Default Checklist" with nine starter items. When the body has no `checklists` key the seeded checklist stays (this is what the old `createService` did). When `checklists` is an array the route deletes every checklist on the new service and creates the given ones in order (this is what the old `duplicateService` did). If any seed insert fails, the route deletes the service (the FK cascade removes its checklists) and returns 500, so a half-created service never lingers in the list.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/services/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();

describe('POST /api/services', () => {
  let org: TestOrgFixture;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
  });

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  const validBody = () => ({
    organization_id: org.organizationId,
    name: 'Deep Clean',
    description: ' Full top to bottom ',
    base_price: 199.5,
    duration_minutes: 180,
    service_type: 'deep',
  });

  function post(body: unknown, token?: string) {
    return callRoute<Body>(POST, {
      method: 'POST',
      url: 'http://test/api/services',
      headers: token ? bearerHeader(token) : {},
      body,
    });
  }

  async function checklistsOf(serviceId: string) {
    const { data } = await db
      .from('checklists')
      .select('id, name, price_adder, position, checklist_line_items ( task, position )')
      .eq('service_type_id', serviceId)
      .order('price_adder', { ascending: true });
    return (data ?? []) as Array<{
      id: string;
      name: string;
      price_adder: number;
      position: number | null;
      checklist_line_items: Array<{ task: string; position: number | null }>;
    }>;
  }

  it('returns 401 without a token', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(401);
  });

  it('returns 400 on an invalid body', async () => {
    const res = await post({ ...validBody(), name: '' }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Service name is required');
  });

  it('returns 403 for a cleaner', async () => {
    const res = await post(validBody(), org.cleaner.accessToken);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a manager without can_manage_services', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const res = await post(validBody(), mgr.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Requires the Manage services permission');
  });

  it('returns 403 for an admin of a different organization', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    const res = await post(validBody(), other.admin.accessToken);
    expect(res.status).toBe(403);
  });

  it('admin creates the service and keeps the trigger-seeded default checklist', async () => {
    const res = await post(validBody(), org.admin.accessToken);
    expect(res.status).toBe(201);
    const data = res.body.data!;
    expect(data.organization_id).toBe(org.organizationId);
    expect(data.name).toBe('Deep Clean');
    expect(data.description).toBe('Full top to bottom');
    expect(Number(data.base_price)).toBe(199.5);
    expect(data.duration_minutes).toBe(180);
    expect(data.is_active).toBe(true);

    const cls = await checklistsOf(data.id as string);
    expect(cls).toHaveLength(1);
    expect(cls[0].name).toBe('Default Checklist');
    expect(cls[0].checklist_line_items.length).toBeGreaterThan(0);
  });

  it('manager with can_manage_services creates the service', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    const res = await post(validBody(), mgr.accessToken);
    expect(res.status).toBe(201);
  });

  it('a checklists array replaces the default checklist, items in order', async () => {
    const res = await post(
      {
        ...validBody(),
        checklists: [
          { name: 'Basic', price_adder: 0, items: ['Dust', ' Vacuum ', ''] },
          { name: 'Plus', price_adder: 25, position: 1, items: [] },
        ],
      },
      org.admin.accessToken,
    );
    expect(res.status).toBe(201);
    const cls = await checklistsOf(res.body.data!.id as string);
    expect(cls.map((c) => c.name)).toEqual(['Basic', 'Plus']);
    expect(cls[1].position).toBe(1);
    const basicItems = [...cls[0].checklist_line_items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    expect(basicItems).toEqual([
      { task: 'Dust', position: 0 },
      { task: 'Vacuum', position: 1 },
    ]);
    expect(cls[1].checklist_line_items).toEqual([]);
  });

  it('an empty checklists array leaves the service with no checklists', async () => {
    const res = await post({ ...validBody(), checklists: [] }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(await checklistsOf(res.body.data!.id as string)).toEqual([]);
  });

  it('deletes the service again when a checklist seed fails', async () => {
    // checklists.price_adder is numeric(10,2); 1e9 overflows it and the insert fails.
    const res = await post(
      { ...validBody(), name: 'Rollback Me', checklists: [{ name: 'Bad', price_adder: 1e9, items: [] }] },
      org.admin.accessToken,
    );
    expect(res.status).toBe(500);
    const { data } = await db
      .from('service_types')
      .select('id')
      .eq('organization_id', org.organizationId)
      .eq('name', 'Rollback Me');
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- src/app/api/services/route.integration.test.ts`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/services/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { parseServiceCreate, type ChecklistSeed } from '@/lib/catalog/serviceInput';

export const runtime = 'nodejs';

/**
 * POST /api/services
 *
 * Creates a service (service_types row). Owner or admin, or a manager with
 * can_manage_services (the same flag migration 104 enforces in RLS).
 *
 * The insert fires create_default_checklist_for_service, which seeds a
 * "Default Checklist". When the body carries `checklists` (an array, even empty)
 * that seeded checklist is removed and the given checklists and items are
 * created in order; when the key is absent the default stays. A failure after
 * the service row exists deletes the service again (the cascade removes its
 * checklists) so a half-created service never lingers.
 *
 * Body: { organization_id, name, description?, base_price, duration_minutes,
 *         service_type, is_active?, checklists?: [{ name, price_adder, position?, items }] }
 * Returns 201 { success: true, data: ServiceType }.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = parseServiceCreate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const auth = await requireManagerPermission(
      request,
      input.organization_id,
      supabaseAdmin,
      'can_manage_services',
      { errorMessage: 'Requires the Manage services permission' },
    );
    if (!auth.ok) return auth.response;

    const { data: service, error: insertError } = await supabaseAdmin
      .from('service_types')
      .insert({
        organization_id: input.organization_id,
        name: input.name,
        description: input.description,
        base_price: input.base_price,
        duration_minutes: input.duration_minutes,
        service_type: input.service_type,
        is_active: input.is_active,
      })
      .select('*')
      .single();
    if (insertError || !service) {
      return NextResponse.json(
        { error: insertError?.message ?? 'Failed to create service' },
        { status: 500 },
      );
    }

    if (input.checklists !== undefined) {
      const seedError = await replaceChecklists(service.id as string, input.checklists);
      if (seedError) {
        await supabaseAdmin.from('service_types').delete().eq('id', service.id);
        return NextResponse.json({ error: seedError }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, data: service }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/** Drops the trigger-seeded checklist(s) and creates the seeds in order. Returns an error message, or null. */
async function replaceChecklists(serviceId: string, seeds: ChecklistSeed[]): Promise<string | null> {
  const { error: delError } = await supabaseAdmin
    .from('checklists')
    .delete()
    .eq('service_type_id', serviceId);
  if (delError) return delError.message;

  for (const seed of seeds) {
    const { data: checklist, error: clError } = await supabaseAdmin
      .from('checklists')
      .insert({
        service_type_id: serviceId,
        name: seed.name,
        price_adder: seed.price_adder,
        position: seed.position,
      })
      .select('id')
      .single();
    if (clError || !checklist) return clError?.message ?? 'Failed to create checklist';

    if (seed.items.length > 0) {
      const { error: itemsError } = await supabaseAdmin
        .from('checklist_line_items')
        .insert(seed.items.map((task, idx) => ({ checklist_id: checklist.id, task, position: idx })));
      if (itemsError) return itemsError.message;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- src/app/api/services/route.integration.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/services/route.ts src/app/api/services/route.integration.test.ts
git commit -m "feat(services): POST /api/services creates a service behind org auth

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 4: `PATCH` and `DELETE /api/services/[id]`

**Files:**
- Create: `src/lib/catalog/resolveCatalogOrg.ts`
- Create: `src/lib/catalog/authorizeCatalog.ts`
- Create: `src/app/api/services/[id]/route.ts`
- Test: `src/app/api/services/[id]/route.integration.test.ts`

**Interfaces:**
- Consumes: `parseServiceUpdate` (Task 2), `isUuid` (Task 2), `requireManagerPermission`, `supabaseAdmin`.
- Produces: `resolveServiceOrg(db: SupabaseClient, serviceId: string): Promise<{ organizationId: string } | null>`; `authorizeService(request, serviceId): Promise<CatalogAuth<{ organizationId: string }>>` where `CatalogAuth<T> = ({ ok: true; userId: string } & T) | { ok: false; response: NextResponse }` (PR B adds `authorizeChecklist` and `authorizeLineItem` beside it); `PATCH /api/services/[id]` → `200 { success: true, data: ServiceType }`; `DELETE /api/services/[id]` → `200 { success: true }` or `409 { error }` when the service is used by an appointment or a recurring series.

Note on ordering: the route resolves the service before checking the token, so an unknown id returns 404 to anyone. Service ids are unguessable UUIDs and the 404 body carries nothing else, so this reveals nothing; it keeps the handler simple.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/services/[id]/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH, DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedService(orgId: string, name = 'Std') {
  const { data, error } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name, base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedAppointmentUsing(orgId: string, homeownerId: string, serviceId: string) {
  const { data: prop, error: propErr } = await db
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: homeownerId,
      name: 'Test Property',
      address: '1 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '00000',
    })
    .select('id')
    .single();
  if (propErr) throw propErr;
  const { error: apptErr } = await db.from('appointments').insert({
    organization_id: orgId,
    homeowner_id: homeownerId,
    cleaner_id: null,
    property_id: prop.id,
    service_type_id: serviceId,
    scheduled_date: '2026-06-01',
    scheduled_time: '10:00',
    duration_minutes: 60,
    total_price: 100,
    status: 'pending',
    is_self_pay: false,
  });
  if (apptErr) throw apptErr;
}

describe('/api/services/[id]', () => {
  let org: TestOrgFixture;
  let serviceId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    serviceId = await seedService(org.organizationId);
  });

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await db.from('appointments').delete().eq('organization_id', org.organizationId);
    await db.from('properties').delete().eq('organization_id', org.organizationId);
    await org.cleanup();
  });

  function patch(id: string, body: unknown, token?: string) {
    return callRoute<Body>(
      (req) => PATCH(req, { params: Promise.resolve({ id }) }),
      { method: 'PATCH', url: `http://test/api/services/${id}`, headers: token ? bearerHeader(token) : {}, body },
    );
  }
  function del(id: string, token?: string) {
    return callRoute<Body>(
      (req) => DELETE(req, { params: Promise.resolve({ id }) }),
      { method: 'DELETE', url: `http://test/api/services/${id}`, headers: token ? bearerHeader(token) : {} },
    );
  }

  describe('PATCH', () => {
    it('returns 404 for an unknown id and for a non-uuid id', async () => {
      expect((await patch(UNKNOWN_ID, { name: 'x' }, org.admin.accessToken)).status).toBe(404);
      expect((await patch('nope', { name: 'x' }, org.admin.accessToken)).status).toBe(404);
    });

    it('returns 401 without a token', async () => {
      expect((await patch(serviceId, { name: 'x' })).status).toBe(401);
    });

    it('returns 403 for a cleaner, a flagless manager, and another org\'s admin', async () => {
      const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
      cleanups.push(() => mgr.cleanup());
      const other = await withTestOrg();
      cleanups.push(() => other.cleanup());
      expect((await patch(serviceId, { name: 'x' }, org.cleaner.accessToken)).status).toBe(403);
      expect((await patch(serviceId, { name: 'x' }, mgr.accessToken)).status).toBe(403);
      expect((await patch(serviceId, { name: 'x' }, other.admin.accessToken)).status).toBe(403);
    });

    it('returns 400 when no valid fields are given', async () => {
      const res = await patch(serviceId, { unrelated: 1 }, org.admin.accessToken);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No valid fields to update');
    });

    it('admin updates a subset of fields and gets the full row back', async () => {
      const res = await patch(serviceId, { name: ' Standard ', is_active: false }, org.admin.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: serviceId, name: 'Standard', is_active: false, duration_minutes: 60 });
      const { data } = await db.from('service_types').select('name, is_active').eq('id', serviceId).single();
      expect(data).toEqual({ name: 'Standard', is_active: false });
    });

    it('manager with can_manage_services updates the service', async () => {
      const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
      cleanups.push(() => mgr.cleanup());
      const res = await patch(serviceId, { base_price: '125' }, mgr.accessToken);
      expect(res.status).toBe(200);
      expect(Number(res.body.data!.base_price)).toBe(125);
    });
  });

  describe('DELETE', () => {
    it('returns 404 for an unknown id', async () => {
      expect((await del(UNKNOWN_ID, org.admin.accessToken)).status).toBe(404);
    });

    it('returns 403 for a cleaner', async () => {
      expect((await del(serviceId, org.cleaner.accessToken)).status).toBe(403);
    });

    it('returns 409 when an appointment uses the service, and leaves it in place', async () => {
      await seedAppointmentUsing(org.organizationId, org.homeowner.userId, serviceId);
      const res = await del(serviceId, org.admin.accessToken);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(
        'Cannot delete service that is used in existing appointments. Consider disabling it instead.',
      );
      const { data } = await db.from('service_types').select('id').eq('id', serviceId);
      expect(data).toHaveLength(1);
    });

    it('admin deletes an unused service and its checklists go with it', async () => {
      const res = await del(serviceId, org.admin.accessToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const { data: svc } = await db.from('service_types').select('id').eq('id', serviceId);
      expect(svc).toEqual([]);
      const { data: cls } = await db.from('checklists').select('id').eq('service_type_id', serviceId);
      expect(cls).toEqual([]);
    });
  });
});
```

The recurring-series branch of the in-use check is not covered by a test: seeding a `recurring_appointment_series` row needs the recurring route's full payload. It is the same query shape as the appointments branch with a different table and message; reviewers check it by reading.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- "src/app/api/services/\[id\]/route.integration.test.ts"`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the resolver, the authorizer, and the route**

```ts
// src/lib/catalog/resolveCatalogOrg.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side lookups that answer "which org owns this catalog row". Routes
 * authorize against the org they return, never against an org id from the body.
 * Extended in PR B with checklist and line-item resolvers.
 */
export async function resolveServiceOrg(
  db: SupabaseClient,
  serviceId: string,
): Promise<{ organizationId: string } | null> {
  const { data } = await db
    .from('service_types')
    .select('organization_id')
    .eq('id', serviceId)
    .maybeSingle();
  return data?.organization_id ? { organizationId: data.organization_id as string } : null;
}
```

```ts
// src/lib/catalog/authorizeCatalog.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { isUuid } from './parse';
import { resolveServiceOrg } from './resolveCatalogOrg';

/**
 * Catalog authorizers: resolve the org that owns a service (PR B: a checklist,
 * a line item), then run the manager-flag check against THAT org. A missing or
 * malformed id is a 404 before any token check; catalog ids are unguessable
 * UUIDs and the 404 body carries nothing else.
 */
export type CatalogAuth<T> =
  | ({ ok: true; userId: string } & T)
  | { ok: false; response: NextResponse };

export const FLAG = 'can_manage_services' as const;
export const MESSAGE = 'Requires the Manage services permission';
export const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 });

export async function authorizeService(
  request: NextRequest,
  serviceId: string,
): Promise<CatalogAuth<{ organizationId: string }>> {
  if (!isUuid(serviceId)) return { ok: false, response: notFound('Service') };
  const target = await resolveServiceOrg(supabaseAdmin, serviceId);
  if (!target) return { ok: false, response: notFound('Service') };
  const auth = await requireManagerPermission(request, target.organizationId, supabaseAdmin, FLAG, {
    errorMessage: MESSAGE,
  });
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId, organizationId: target.organizationId };
}
```

```ts
// src/app/api/services/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeService } from '@/lib/catalog/authorizeCatalog';
import { parseServiceUpdate } from '@/lib/catalog/serviceInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/services/:id
 * Partial update of a service. Body: any of { name, description, base_price,
 * duration_minutes, service_type, is_active }. Returns { success: true, data: ServiceType }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeService(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseServiceUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('service_types')
      .update(parsed.value)
      .eq('id', id)
      .eq('organization_id', auth.organizationId)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to update service' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/services/:id
 * Refuses (409) while any appointment or recurring series references the
 * service, with the same wording the client used to show. Otherwise deletes it
 * (checklists and items cascade). Returns { success: true }.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeService(request, id);
    if (!auth.ok) return auth.response;

    const [appts, series] = await Promise.all([
      supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }).eq('service_type_id', id),
      supabaseAdmin
        .from('recurring_appointment_series')
        .select('id', { count: 'exact', head: true })
        .eq('service_type_id', id),
    ]);
    if (appts.error || series.error) {
      return NextResponse.json(
        { error: appts.error?.message ?? series.error?.message ?? 'Failed to check service usage' },
        { status: 500 },
      );
    }
    if ((appts.count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete service that is used in existing appointments. Consider disabling it instead.' },
        { status: 409 },
      );
    }
    if ((series.count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete service that is used in recurring appointment series. Consider disabling it instead.' },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin
      .from('service_types')
      .delete()
      .eq('id', id)
      .eq('organization_id', auth.organizationId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- "src/app/api/services/\[id\]/route.integration.test.ts"`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/resolveCatalogOrg.ts src/lib/catalog/authorizeCatalog.ts "src/app/api/services/[id]/route.ts" "src/app/api/services/[id]/route.integration.test.ts"
git commit -m "feat(services): PATCH and DELETE /api/services/[id] behind org auth

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 5: `services-api.ts` and the `useServices` rewire

**Files:**
- Create: `src/hooks/services-api.ts`
- Modify: `src/hooks/useServices.ts` (the four exported write functions; everything else untouched)
- Modify: `src/components/redesign/services/OperatorServices.tsx` (two call sites)

**Interfaces:**
- Consumes: `apiFetch`, `ApiResult` (Task 1); `ChecklistSeed` (Task 2); routes from Tasks 3 and 4.
- Produces: `createServiceApi(body)`, `updateServiceApi(serviceId, body)`, `deleteServiceApi(serviceId)`. Exported hook functions keep their return type `{ success: boolean; data?: ServiceType; error?: string }`. Signature changes: `updateService(serviceId, data)` and `toggleServiceActive(serviceId, isActive)` no longer take `organizationId` (the route resolves the org itself).

- [ ] **Step 1: Write the API module**

```ts
// src/hooks/services-api.ts
import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { ChecklistSeed } from '@/lib/catalog/serviceInput';
import type { ServiceType, UpdateServiceData } from './useServices';

export interface CreateServiceBody {
  organization_id: string;
  name: string;
  description?: string | null;
  base_price: number;
  duration_minutes: number;
  service_type: string;
  is_active?: boolean;
  /** Present only when cloning: replaces the trigger-seeded default checklist. */
  checklists?: ChecklistSeed[];
}

export const createServiceApi = (body: CreateServiceBody): Promise<ApiResult<ServiceType>> =>
  apiFetch<ServiceType>('/api/services', { method: 'POST', body });

export const updateServiceApi = (serviceId: string, body: UpdateServiceData): Promise<ApiResult<ServiceType>> =>
  apiFetch<ServiceType>(`/api/services/${serviceId}`, { method: 'PATCH', body });

export const deleteServiceApi = (serviceId: string): Promise<ApiResult<void>> =>
  apiFetch<void>(`/api/services/${serviceId}`, { method: 'DELETE' });
```

- [ ] **Step 2: Rewire the four write functions in `useServices.ts`**

Add the import near the top of `src/hooks/useServices.ts`:

```ts
import { createServiceApi, deleteServiceApi, updateServiceApi } from './services-api';
import type { ChecklistSeed } from '@/lib/catalog/serviceInput';
```

Replace the body of `createService` (keep the signature and the JSDoc comment above it):

```ts
export async function createService(
  organizationId: string,
  data: CreateServiceData
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  const res = await createServiceApi({
    organization_id: organizationId,
    name: data.name,
    description: data.description ?? null,
    base_price: data.base_price,
    duration_minutes: data.duration_minutes,
    service_type: data.service_type,
    is_active: data.is_active ?? true,
  });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}
```

Replace `updateService` entirely (the `organizationId` parameter and the PGRST116 handling go away; the route scopes by org and returns 404 or 403 instead):

```ts
// Update an existing service. The route resolves the service's org and checks the
// caller's role there, so a wrong-org or missing service reads as "not found".
export async function updateService(
  serviceId: string,
  data: UpdateServiceData
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  const res = await updateServiceApi(serviceId, data);
  if (res.success) return { success: true, data: res.data };
  if (res.status === 404 || res.status === 403) {
    return { success: false, error: "Service not found or you don't have permission to update it." };
  }
  return { success: false, error: res.error };
}
```

Replace `deleteService` (the in-use checks now live in the route and come back as a 409 message):

```ts
// Delete a service. The route refuses with 409 while appointments or series use it.
export async function deleteService(
  serviceId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await deleteServiceApi(serviceId);
  return res.success ? { success: true } : { success: false, error: res.error };
}
```

Replace `toggleServiceActive`:

```ts
// Toggle service active status.
export async function toggleServiceActive(
  serviceId: string,
  isActive: boolean
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  return updateService(serviceId, { is_active: isActive });
}
```

Leave `canDeleteService` exactly as it is (it is a read).

Replace `duplicateService`. The reads stay direct under RLS; the create goes through the route with `checklists` so the route removes the trigger-seeded default and copies the source's checklists. Keep the `ChecklistWithItemsRow` type above it, and add the shared sort as a local helper:

```ts
// Order line items the way useChecklists renders them: position asc, NULLs last,
// created_at as the tiebreaker.
function sortLineItems<T extends { position: number | null; created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.position === null && b.position === null) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    if (a.position !== b.position) return a.position - b.position;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

// Duplicate a service, cloning all of its checklists + line items. The source is
// read here (reads stay direct); the clone is created by POST /api/services with
// `checklists`, which drops the trigger-seeded default and copies these instead,
// and which deletes the clone again if any checklist fails to copy.
export async function duplicateService(
  organizationId: string,
  serviceId: string
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  const { data: source, error: srcError } = await supabase
    .from('service_types')
    .select('*')
    .eq('id', serviceId)
    .eq('organization_id', organizationId)
    .single();
  if (srcError || !source) {
    return { success: false, error: srcError?.message ?? 'Service not found' };
  }
  const src = source as ServiceType;

  const { data: srcChecklists, error: clError } = await supabase
    .from('checklists')
    .select('*, checklist_line_items (*)')
    .eq('service_type_id', serviceId);
  if (clError) return { success: false, error: clError.message };

  const checklists: ChecklistSeed[] = ((srcChecklists ?? []) as ChecklistWithItemsRow[]).map((cl) => ({
    name: cl.name,
    price_adder: Number(cl.price_adder) || 0,
    position: cl.position,
    items: sortLineItems(cl.checklist_line_items ?? []).map((it) => it.task),
  }));

  const res = await createServiceApi({
    organization_id: organizationId,
    name: `${src.name} (copy)`,
    description: src.description,
    base_price: Number(src.base_price),
    duration_minutes: src.duration_minutes,
    service_type: src.service_type,
    is_active: src.is_active,
    checklists,
  });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}
```

Delete the old `try/catch` bodies these replace, including the `createdServiceId` cleanup block. `supabase` stays imported (the reads and the query hooks still use it).

- [ ] **Step 3: Update the two call sites in `OperatorServices.tsx`**

Line 263: `const r = await updateService(selectedService.id, v, orgId);` becomes `const r = await updateService(selectedService.id, v);`

Line 311: `const r = await toggleServiceActive(selectedService.id, next, orgId);` becomes `const r = await toggleServiceActive(selectedService.id, next);`

Then remove `orgId` from the dependency arrays of those two `useCallback`s only if ESLint's `react-hooks/exhaustive-deps` flags it as unnecessary (it does not flag extra deps as errors; leave them if lint is quiet).

- [ ] **Step 4: Run the gates**

Run: `npx tsc --noEmit 2>&1 | grep -E "useServices|services-api|OperatorServices|api/services"`
Expected: no lines (no type errors in the touched files).

Run: `npm run lint`
Expected: no errors in the touched files.

Run: `npm run test:unit -- src/lib/auth src/lib/catalog`
Expected: pass.

Run: `npm run test:integration -- src/app/api/services`
Expected: pass (20 tests across the two route files).

- [ ] **Step 5: Smoke it in the browser**

With `npm run dev` and `npx supabase start` running, sign in as an operator, open Services, and: create a service (the default checklist appears), rename it, toggle it inactive and back, duplicate it (the copy carries the checklists), delete the copy. Every action shows its existing toast. If anything fails, the Network tab shows the route's `{ error }`.

- [ ] **Step 6: Commit, push, open PR A**

```bash
git add src/hooks/services-api.ts src/hooks/useServices.ts src/components/redesign/services/OperatorServices.tsx
git commit -m "feat(services): route the service writes through /api/services

createService, updateService, deleteService and duplicateService now call the
routes; reads and cache helpers are unchanged. updateService and
toggleServiceActive drop their organizationId argument (the route resolves it).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
git push -u origin feat/phase1a-services-routes
gh pr create --base master --title "feat(services): service writes go through API routes (Phase 1a, PR A)" --body "$(cat <<'EOF'
## Summary
- New routes: `POST /api/services`, `PATCH /api/services/[id]`, `DELETE /api/services/[id]`, each authorized with `requireManagerPermission(... 'can_manage_services')` against the service's own org.
- `useServices.ts` write functions call the routes; reads and cache helpers unchanged. `updateService` / `toggleServiceActive` drop the `organizationId` arg.
- Shared helpers for PRs B and C: `apiFetch`, `src/lib/catalog/parse.ts`, `resolveCatalogOrg.ts`.
- Spec: `docs/superpowers/specs/2026-09-08-saas-billing-design.md` §4, §12.1. Plan: `docs/superpowers/plans/2026-09-12-phase1a-write-routes.md` Tasks 1 to 5.

## Test plan
- [x] unit: `apiFetch`, `parse`, `serviceInput`
- [x] integration: both route files (401/403/404/400/409/happy paths, checklist seeding and rollback)
- [x] manual: create, rename, toggle, duplicate, delete on the Services page

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
EOF
)"
```

Fable reviews the PR diff before merge. Do not merge yet; PRs B and C stack on this branch.

---

# PR B: checklists (`feat/phase1a-checklist-routes`)

Start: `git checkout -b feat/phase1a-checklist-routes feat/phase1a-services-routes` (this branch stacks on A).

### Task 6: checklist body parsers

**Files:**
- Create: `src/lib/catalog/checklistInput.ts`
- Test: `src/lib/catalog/checklistInput.test.ts`

**Interfaces:**
- Consumes: `asRecord`, `isUuid`, `parseMoney`, `ParseResult` from `./parse` (Task 2).
- Produces: `parseChecklistCreate(body) → { name, price_adder, items }`, `parseChecklistUpdate(body) → { name?, price_adder? }`, `parseItemsCreate(body) → { tasks: string[] }`, `parseItemUpdate(body) → { task }`, `parseOrder(body) → { item_ids: string[] }`, `orderMatchesItems(itemIds, existingIds): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/catalog/checklistInput.test.ts
import { describe, it, expect } from 'vitest';
import {
  orderMatchesItems,
  parseChecklistCreate,
  parseChecklistUpdate,
  parseItemUpdate,
  parseItemsCreate,
  parseOrder,
} from './checklistInput';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('parseChecklistCreate', () => {
  it('defaults name, price and items', () => {
    expect(parseChecklistCreate({})).toEqual({ ok: true, value: { name: 'New Checklist', price_adder: 0, items: [] } });
    expect(parseChecklistCreate({ name: '  ' })).toEqual({ ok: true, value: { name: 'New Checklist', price_adder: 0, items: [] } });
  });
  it('trims name and items, drops blank items, parses price strings', () => {
    expect(parseChecklistCreate({ name: ' Plus ', price_adder: '25', items: [' Dust ', '', 'Mop'] })).toEqual({
      ok: true,
      value: { name: 'Plus', price_adder: 25, items: ['Dust', 'Mop'] },
    });
  });
  it('rejects a bad price, non-text items, an over-long name, and a non-object body', () => {
    expect(parseChecklistCreate({ price_adder: -1 })).toEqual({ ok: false, error: 'Checklist price must be a number of 0 or more' });
    expect(parseChecklistCreate({ items: [1] })).toEqual({ ok: false, error: 'Checklist items must be text' });
    expect(parseChecklistCreate({ name: 'x'.repeat(121) })).toEqual({ ok: false, error: 'Checklist name must be 120 characters or fewer' });
    expect(parseChecklistCreate([])).toEqual({ ok: false, error: 'Request body must be a JSON object' });
  });
});

describe('parseChecklistUpdate', () => {
  it('accepts either field', () => {
    expect(parseChecklistUpdate({ name: ' Basic ' })).toEqual({ ok: true, value: { name: 'Basic' } });
    expect(parseChecklistUpdate({ price_adder: 10 })).toEqual({ ok: true, value: { price_adder: 10 } });
    expect(parseChecklistUpdate({ name: 'Basic', price_adder: '10' })).toEqual({ ok: true, value: { name: 'Basic', price_adder: 10 } });
  });
  it('rejects a blank name with the message the page already shows, and an empty update', () => {
    expect(parseChecklistUpdate({ name: '  ' })).toEqual({ ok: false, error: 'Checklist name cannot be empty' });
    expect(parseChecklistUpdate({})).toEqual({ ok: false, error: 'No valid fields to update' });
  });
});

describe('parseItemsCreate', () => {
  it('accepts a single task', () => {
    expect(parseItemsCreate({ task: ' Dust ' })).toEqual({ ok: true, value: { tasks: ['Dust'] } });
  });
  it('accepts many tasks, trimmed, blanks dropped', () => {
    expect(parseItemsCreate({ tasks: [' Dust ', '', 'Mop'] })).toEqual({ ok: true, value: { tasks: ['Dust', 'Mop'] } });
  });
  it('rejects a blank single task, an empty list, and non-text', () => {
    expect(parseItemsCreate({ task: '  ' })).toEqual({ ok: false, error: 'Task cannot be empty' });
    expect(parseItemsCreate({})).toEqual({ ok: false, error: 'Task cannot be empty' });
    expect(parseItemsCreate({ tasks: ['', ' '] })).toEqual({ ok: false, error: 'No tasks to add' });
    expect(parseItemsCreate({ tasks: 'Dust' })).toEqual({ ok: false, error: 'Checklist items must be text' });
  });
});

describe('parseItemUpdate', () => {
  it('trims the task and rejects blank', () => {
    expect(parseItemUpdate({ task: ' Mop ' })).toEqual({ ok: true, value: { task: 'Mop' } });
    expect(parseItemUpdate({ task: '' })).toEqual({ ok: false, error: 'Task cannot be empty' });
    expect(parseItemUpdate({})).toEqual({ ok: false, error: 'Task cannot be empty' });
  });
});

describe('parseOrder', () => {
  it('accepts a list of unique ids', () => {
    expect(parseOrder({ item_ids: [B, A] })).toEqual({ ok: true, value: { item_ids: [B, A] } });
  });
  it('rejects empty, non-uuid, and duplicate lists', () => {
    const err = { ok: false, error: 'item_ids must be a list of unique item ids' };
    expect(parseOrder({ item_ids: [] })).toEqual(err);
    expect(parseOrder({ item_ids: ['x'] })).toEqual(err);
    expect(parseOrder({ item_ids: [A, A] })).toEqual(err);
    expect(parseOrder({})).toEqual(err);
  });
});

describe('orderMatchesItems', () => {
  it('is true only when both lists hold the same ids', () => {
    expect(orderMatchesItems([C, A, B], [A, B, C])).toBe(true);
    expect(orderMatchesItems([A, B], [A, B, C])).toBe(false);
    expect(orderMatchesItems([A, B, C], [A, B])).toBe(false);
    expect(orderMatchesItems([A, B, '44444444-4444-4444-8444-444444444444'], [A, B, C])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- src/lib/catalog/checklistInput.test.ts`
Expected: FAIL, cannot resolve `./checklistInput`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/catalog/checklistInput.ts
import { asRecord, isUuid, parseMoney, type ParseResult } from './parse';

export const CHECKLIST_NAME_MAX = 120;

export interface ChecklistCreateInput { name: string; price_adder: number; items: string[] }
export interface ChecklistUpdateInput { name?: string; price_adder?: number }
export interface ItemsCreateInput { tasks: string[] }
export interface ItemUpdateInput { task: string }
export interface OrderInput { item_ids: string[] }

const NOT_OBJECT = { ok: false as const, error: 'Request body must be a JSON object' };

function parseTasks(v: unknown): ParseResult<string[]> {
  if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) {
    return { ok: false, error: 'Checklist items must be text' };
  }
  return { ok: true, value: (v as string[]).map((t) => t.trim()).filter(Boolean) };
}

function checkNameLength(name: string): ParseResult<string> {
  if (name.length > CHECKLIST_NAME_MAX) {
    return { ok: false, error: `Checklist name must be ${CHECKLIST_NAME_MAX} characters or fewer` };
  }
  return { ok: true, value: name };
}

/** A blank or absent name becomes "New Checklist", matching the old createChecklist default. */
export function parseChecklistCreate(body: unknown): ParseResult<ChecklistCreateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  const rawName = typeof r.name === 'string' ? r.name.trim() : '';
  const name = checkNameLength(rawName || 'New Checklist');
  if (!name.ok) return name;
  const price = parseMoney(r.price_adder ?? 0, 'Checklist price');
  if (!price.ok) return price;
  const items = parseTasks(r.items ?? []);
  if (!items.ok) return items;
  return { ok: true, value: { name: name.value, price_adder: price.value, items: items.value } };
}

export function parseChecklistUpdate(body: unknown): ParseResult<ChecklistUpdateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  const value: ChecklistUpdateInput = {};
  if (r.name !== undefined) {
    const trimmed = typeof r.name === 'string' ? r.name.trim() : '';
    if (!trimmed) return { ok: false, error: 'Checklist name cannot be empty' };
    const name = checkNameLength(trimmed);
    if (!name.ok) return name;
    value.name = name.value;
  }
  if (r.price_adder !== undefined) {
    const price = parseMoney(r.price_adder, 'Checklist price');
    if (!price.ok) return price;
    value.price_adder = price.value;
  }
  if (Object.keys(value).length === 0) return { ok: false, error: 'No valid fields to update' };
  return { ok: true, value };
}

/** `{ task }` for one item, `{ tasks }` for many. Wording matches the old client functions. */
export function parseItemsCreate(body: unknown): ParseResult<ItemsCreateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  if (r.tasks !== undefined) {
    const tasks = parseTasks(r.tasks);
    if (!tasks.ok) return tasks;
    if (tasks.value.length === 0) return { ok: false, error: 'No tasks to add' };
    return { ok: true, value: { tasks: tasks.value } };
  }
  const task = typeof r.task === 'string' ? r.task.trim() : '';
  if (!task) return { ok: false, error: 'Task cannot be empty' };
  return { ok: true, value: { tasks: [task] } };
}

export function parseItemUpdate(body: unknown): ParseResult<ItemUpdateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  const task = typeof r.task === 'string' ? r.task.trim() : '';
  if (!task) return { ok: false, error: 'Task cannot be empty' };
  return { ok: true, value: { task } };
}

export function parseOrder(body: unknown): ParseResult<OrderInput> {
  const r = asRecord(body);
  const ids = r?.item_ids;
  const bad = { ok: false as const, error: 'item_ids must be a list of unique item ids' };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUuid)) return bad;
  if (new Set(ids).size !== ids.length) return bad;
  return { ok: true, value: { item_ids: ids as string[] } };
}

/** True when `itemIds` is a permutation of `existingIds`. */
export function orderMatchesItems(itemIds: string[], existingIds: string[]): boolean {
  if (itemIds.length !== existingIds.length) return false;
  const want = new Set(existingIds);
  return itemIds.every((id) => want.has(id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- src/lib/catalog/checklistInput.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/checklistInput.ts src/lib/catalog/checklistInput.test.ts
git commit -m "feat(checklists): pure body parsers for the checklist routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 7: checklist and line-item resolvers, `POST /api/services/[id]/checklists`

**Files:**
- Modify: `src/lib/catalog/resolveCatalogOrg.ts` (add two resolvers)
- Modify: `src/lib/catalog/authorizeCatalog.ts` (add two authorizers)
- Create: `src/app/api/services/[id]/checklists/route.ts`
- Test: `src/app/api/services/[id]/checklists/route.integration.test.ts`

**Interfaces:**
- Consumes: `authorizeService` (Task 4), `parseChecklistCreate` (Task 6).
- Produces: `resolveChecklistOrg(db, checklistId) → { organizationId, serviceTypeId } | null`; `resolveLineItemOrg(db, itemId) → { organizationId, serviceTypeId, checklistId } | null`; `authorizeChecklist(request, checklistId)`, `authorizeLineItem(request, itemId)` with the same result shape as `authorizeService` plus the extra ids; `POST /api/services/[id]/checklists` → `201 { success: true, data: ChecklistWithItems }`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/services/[id]/checklists/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

type Item = { id: string; task: string; position: number | null; checklist_id: string };
type Body = {
  success?: boolean;
  data?: { id: string; name: string; price_adder: number; service_type_id: string; checklist_line_items: Item[] };
  error?: string;
};

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedService(orgId: string) {
  const { data, error } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

describe('POST /api/services/[id]/checklists', () => {
  let org: TestOrgFixture;
  let serviceId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    serviceId = await seedService(org.organizationId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  function post(id: string, body: unknown, token?: string) {
    return callRoute<Body>(
      (req) => POST(req, { params: Promise.resolve({ id }) }),
      { method: 'POST', url: `http://test/api/services/${id}/checklists`, headers: token ? bearerHeader(token) : {}, body },
    );
  }

  it('returns 404 for an unknown service', async () => {
    expect((await post(UNKNOWN_ID, { name: 'x' }, org.admin.accessToken)).status).toBe(404);
  });
  it('returns 401 without a token', async () => {
    expect((await post(serviceId, { name: 'x' })).status).toBe(401);
  });
  it('returns 403 for a cleaner, a flagless manager, and another org\'s admin', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: false });
    cleanups.push(() => mgr.cleanup());
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await post(serviceId, { name: 'x' }, org.cleaner.accessToken)).status).toBe(403);
    expect((await post(serviceId, { name: 'x' }, mgr.accessToken)).status).toBe(403);
    expect((await post(serviceId, { name: 'x' }, other.admin.accessToken)).status).toBe(403);
  });
  it('returns 400 on a bad price', async () => {
    const res = await post(serviceId, { name: 'x', price_adder: -1 }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Checklist price must be a number of 0 or more');
  });

  it('admin creates a checklist with items in order and gets them back nested', async () => {
    const res = await post(serviceId, { name: ' Plus ', price_adder: 25, items: ['Dust', ' Mop ', ''] }, org.admin.accessToken);
    expect(res.status).toBe(201);
    const data = res.body.data!;
    expect(data).toMatchObject({ name: 'Plus', service_type_id: serviceId });
    expect(Number(data.price_adder)).toBe(25);
    expect(data.checklist_line_items.map((i) => [i.task, i.position])).toEqual([['Dust', 0], ['Mop', 1]]);
    const { data: rows } = await db.from('checklist_line_items').select('task').eq('checklist_id', data.id);
    expect(rows).toHaveLength(2);
  });

  it('a blank name becomes "New Checklist" and no items gives an empty array', async () => {
    const res = await post(serviceId, { name: '', price_adder: 0 }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'New Checklist', checklist_line_items: [] });
  });

  it('manager with can_manage_services creates a checklist', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_manage_services: true });
    cleanups.push(() => mgr.cleanup());
    expect((await post(serviceId, { name: 'Mgr', price_adder: 0 }, mgr.accessToken)).status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- "src/app/api/services/\[id\]/checklists/route.integration.test.ts"`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Extend the resolvers and authorizers, write the route**

Append to `src/lib/catalog/resolveCatalogOrg.ts`:

```ts
/**
 * The org and service a checklist belongs to. PostgREST returns the to-one
 * `service_types` embed as an object; the Array check guards an untyped client.
 */
export async function resolveChecklistOrg(
  db: SupabaseClient,
  checklistId: string,
): Promise<{ organizationId: string; serviceTypeId: string } | null> {
  const { data } = await db
    .from('checklists')
    .select('service_type_id, service_types ( organization_id )')
    .eq('id', checklistId)
    .maybeSingle();
  if (!data?.service_type_id) return null;
  const rel = data.service_types as { organization_id?: string } | { organization_id?: string }[] | null;
  const organizationId = Array.isArray(rel) ? rel[0]?.organization_id : rel?.organization_id;
  return organizationId ? { organizationId, serviceTypeId: data.service_type_id as string } : null;
}

/** The org, service and checklist a line item belongs to. */
export async function resolveLineItemOrg(
  db: SupabaseClient,
  itemId: string,
): Promise<{ organizationId: string; serviceTypeId: string; checklistId: string } | null> {
  const { data } = await db
    .from('checklist_line_items')
    .select('checklist_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!data?.checklist_id) return null;
  const checklist = await resolveChecklistOrg(db, data.checklist_id as string);
  return checklist ? { ...checklist, checklistId: data.checklist_id as string } : null;
}
```

Append to `src/lib/catalog/authorizeCatalog.ts`, and change its import line to `import { resolveChecklistOrg, resolveLineItemOrg, resolveServiceOrg } from './resolveCatalogOrg';`:

```ts
export async function authorizeChecklist(
  request: NextRequest,
  checklistId: string,
): Promise<CatalogAuth<{ organizationId: string; serviceTypeId: string }>> {
  if (!isUuid(checklistId)) return { ok: false, response: notFound('Checklist') };
  const target = await resolveChecklistOrg(supabaseAdmin, checklistId);
  if (!target) return { ok: false, response: notFound('Checklist') };
  const auth = await requireManagerPermission(request, target.organizationId, supabaseAdmin, FLAG, {
    errorMessage: MESSAGE,
  });
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId, ...target };
}

export async function authorizeLineItem(
  request: NextRequest,
  itemId: string,
): Promise<CatalogAuth<{ organizationId: string; serviceTypeId: string; checklistId: string }>> {
  if (!isUuid(itemId)) return { ok: false, response: notFound('Task') };
  const target = await resolveLineItemOrg(supabaseAdmin, itemId);
  if (!target) return { ok: false, response: notFound('Task') };
  const auth = await requireManagerPermission(request, target.organizationId, supabaseAdmin, FLAG, {
    errorMessage: MESSAGE,
  });
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId, ...target };
}
```

```ts
// src/app/api/services/[id]/checklists/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeService } from '@/lib/catalog/authorizeCatalog';
import { parseChecklistCreate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/services/:id/checklists
 * Creates a checklist (tier) on a service with its items in the given order.
 * Body: { name?, price_adder?, items?: string[] }.
 * Returns 201 { success: true, data: ChecklistWithItems }. If the items insert
 * fails the checklist is deleted again and the error is returned.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeService(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseChecklistCreate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const { data: checklist, error: clError } = await supabaseAdmin
      .from('checklists')
      .insert({ service_type_id: id, name: input.name, price_adder: input.price_adder })
      .select('*')
      .single();
    if (clError || !checklist) {
      return NextResponse.json({ error: clError?.message ?? 'Failed to create checklist' }, { status: 500 });
    }

    let items: unknown[] = [];
    if (input.items.length > 0) {
      const { data: inserted, error: itemsError } = await supabaseAdmin
        .from('checklist_line_items')
        .insert(input.items.map((task, idx) => ({ checklist_id: checklist.id, task, position: idx })))
        .select('*')
        .order('position', { ascending: true });
      if (itemsError) {
        await supabaseAdmin.from('checklists').delete().eq('id', checklist.id);
        return NextResponse.json({ error: itemsError.message }, { status: 500 });
      }
      items = inserted ?? [];
    }

    return NextResponse.json(
      { success: true, data: { ...checklist, checklist_line_items: items } },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- "src/app/api/services/\[id\]/checklists/route.integration.test.ts"`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/resolveCatalogOrg.ts src/lib/catalog/authorizeCatalog.ts "src/app/api/services/[id]/checklists/route.ts" "src/app/api/services/[id]/checklists/route.integration.test.ts"
git commit -m "feat(checklists): POST /api/services/[id]/checklists and checklist resolvers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 8: `PATCH` and `DELETE /api/checklists/[id]`

**Files:**
- Create: `src/app/api/checklists/[id]/route.ts`
- Test: `src/app/api/checklists/[id]/route.integration.test.ts`

**Interfaces:**
- Consumes: `authorizeChecklist` (Task 7), `parseChecklistUpdate` (Task 6).
- Produces: `PATCH /api/checklists/[id]` → `200 { success: true, data: Checklist }`; `DELETE` → `200 { success: true }`.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/checklists/[id]/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH, DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedChecklist(orgId: string) {
  const { data: svc, error: svcErr } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (svcErr) throw svcErr;
  const { data: cl, error: clErr } = await db
    .from('checklists')
    .insert({ service_type_id: svc.id, name: 'Basic', price_adder: 0 })
    .select('id')
    .single();
  if (clErr) throw clErr;
  const { error: itemErr } = await db
    .from('checklist_line_items')
    .insert([{ checklist_id: cl.id, task: 'Dust', position: 0 }]);
  if (itemErr) throw itemErr;
  return cl.id as string;
}

describe('/api/checklists/[id]', () => {
  let org: TestOrgFixture;
  let checklistId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    checklistId = await seedChecklist(org.organizationId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  const patch = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => PATCH(req, { params: Promise.resolve({ id }) }), {
      method: 'PATCH', url: `http://test/api/checklists/${id}`, headers: token ? bearerHeader(token) : {}, body,
    });
  const del = (id: string, token?: string) =>
    callRoute<Body>((req) => DELETE(req, { params: Promise.resolve({ id }) }), {
      method: 'DELETE', url: `http://test/api/checklists/${id}`, headers: token ? bearerHeader(token) : {},
    });

  it('PATCH returns 404 for an unknown checklist and 401 without a token', async () => {
    expect((await patch(UNKNOWN_ID, { name: 'x' }, org.admin.accessToken)).status).toBe(404);
    expect((await patch(checklistId, { name: 'x' })).status).toBe(401);
  });

  it('PATCH returns 403 for a cleaner and for another org\'s admin', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await patch(checklistId, { name: 'x' }, org.cleaner.accessToken)).status).toBe(403);
    expect((await patch(checklistId, { name: 'x' }, other.admin.accessToken)).status).toBe(403);
  });

  it('PATCH returns 400 for a blank name', async () => {
    const res = await patch(checklistId, { name: '  ' }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Checklist name cannot be empty');
  });

  it('PATCH updates name and price and returns the row', async () => {
    const res = await patch(checklistId, { name: ' Deluxe ', price_adder: '40' }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: checklistId, name: 'Deluxe' });
    expect(Number(res.body.data!.price_adder)).toBe(40);
  });

  it('DELETE returns 403 for a cleaner', async () => {
    expect((await del(checklistId, org.cleaner.accessToken)).status).toBe(403);
  });

  it('DELETE removes the checklist and its items', async () => {
    const res = await del(checklistId, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const { data: cl } = await db.from('checklists').select('id').eq('id', checklistId);
    expect(cl).toEqual([]);
    const { data: items } = await db.from('checklist_line_items').select('id').eq('checklist_id', checklistId);
    expect(items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- "src/app/api/checklists/\[id\]/route.integration.test.ts"`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/checklists/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeChecklist } from '@/lib/catalog/authorizeCatalog';
import { parseChecklistUpdate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/checklists/:id
 * Body: { name?, price_adder? }. Returns { success: true, data: Checklist }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseChecklistUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('checklists')
      .update(parsed.value)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to update checklist' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/checklists/:id
 * Deletes the checklist; its line items cascade. Returns { success: true }.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const { error } = await supabaseAdmin.from('checklists').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- "src/app/api/checklists/\[id\]/route.integration.test.ts"`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/checklists/[id]/route.ts" "src/app/api/checklists/[id]/route.integration.test.ts"
git commit -m "feat(checklists): PATCH and DELETE /api/checklists/[id]

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 9: line items: `POST /api/checklists/[id]/items`, `PATCH` and `DELETE /api/checklist-items/[itemId]`

**Files:**
- Create: `src/app/api/checklists/[id]/items/route.ts`
- Create: `src/app/api/checklist-items/[itemId]/route.ts`
- Test: `src/app/api/checklists/[id]/items/route.integration.test.ts`, `src/app/api/checklist-items/[itemId]/route.integration.test.ts`

**Interfaces:**
- Consumes: `authorizeChecklist`, `authorizeLineItem` (Task 7); `parseItemsCreate`, `parseItemUpdate` (Task 6).
- Produces: `POST /api/checklists/[id]/items` → `201 { success: true, data: ChecklistLineItem[] }` (rows in the order given, `position` null); `PATCH /api/checklist-items/[itemId]` → `200 { success: true, data: ChecklistLineItem }`; `DELETE` → `200 { success: true }`.

- [ ] **Step 1: Write the failing integration tests**

```ts
// src/app/api/checklists/[id]/items/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';

type Item = { id: string; task: string; position: number | null; checklist_id: string };
type Body = { success?: boolean; data?: Item[]; error?: string };

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedChecklist(orgId: string) {
  const { data: svc, error: svcErr } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (svcErr) throw svcErr;
  const { data: cl, error: clErr } = await db
    .from('checklists')
    .insert({ service_type_id: svc.id, name: 'Basic', price_adder: 0 })
    .select('id')
    .single();
  if (clErr) throw clErr;
  return cl.id as string;
}

describe('POST /api/checklists/[id]/items', () => {
  let org: TestOrgFixture;
  let checklistId: string;

  beforeEach(async () => {
    org = await withTestOrg();
    checklistId = await seedChecklist(org.organizationId);
  });
  afterEach(async () => {
    await org.cleanup();
  });

  const post = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => POST(req, { params: Promise.resolve({ id }) }), {
      method: 'POST', url: `http://test/api/checklists/${id}/items`, headers: token ? bearerHeader(token) : {}, body,
    });

  it('returns 404, 401 and 403 as expected', async () => {
    expect((await post(UNKNOWN_ID, { task: 'x' }, org.admin.accessToken)).status).toBe(404);
    expect((await post(checklistId, { task: 'x' })).status).toBe(401);
    expect((await post(checklistId, { task: 'x' }, org.cleaner.accessToken)).status).toBe(403);
  });

  it('returns 400 for a blank task and for an empty list', async () => {
    expect((await post(checklistId, { task: '  ' }, org.admin.accessToken)).body.error).toBe('Task cannot be empty');
    expect((await post(checklistId, { tasks: ['', ' '] }, org.admin.accessToken)).body.error).toBe('No tasks to add');
  });

  it('adds one task with position null', async () => {
    const res = await post(checklistId, { task: ' Dust ' }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data![0]).toMatchObject({ task: 'Dust', position: null, checklist_id: checklistId });
  });

  it('adds many tasks in the order given, all with position null', async () => {
    const res = await post(checklistId, { tasks: ['Dust', 'Mop', ' Vacuum '] }, org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data!.map((i) => i.task)).toEqual(['Dust', 'Mop', 'Vacuum']);
    expect(res.body.data!.every((i) => i.position === null)).toBe(true);
    const { count } = await db
      .from('checklist_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('checklist_id', checklistId);
    expect(count).toBe(3);
  });
});
```

```ts
// src/app/api/checklist-items/[itemId]/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH, DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

async function seedItem(orgId: string) {
  const { data: svc, error: svcErr } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (svcErr) throw svcErr;
  const { data: cl, error: clErr } = await db
    .from('checklists')
    .insert({ service_type_id: svc.id, name: 'Basic', price_adder: 0 })
    .select('id')
    .single();
  if (clErr) throw clErr;
  const { data: item, error: itemErr } = await db
    .from('checklist_line_items')
    .insert({ checklist_id: cl.id, task: 'Dust', position: 0 })
    .select('id')
    .single();
  if (itemErr) throw itemErr;
  return item.id as string;
}

describe('/api/checklist-items/[itemId]', () => {
  let org: TestOrgFixture;
  let itemId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    itemId = await seedItem(org.organizationId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await org.cleanup();
  });

  const patch = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => PATCH(req, { params: Promise.resolve({ itemId: id }) }), {
      method: 'PATCH', url: `http://test/api/checklist-items/${id}`, headers: token ? bearerHeader(token) : {}, body,
    });
  const del = (id: string, token?: string) =>
    callRoute<Body>((req) => DELETE(req, { params: Promise.resolve({ itemId: id }) }), {
      method: 'DELETE', url: `http://test/api/checklist-items/${id}`, headers: token ? bearerHeader(token) : {},
    });

  it('PATCH returns 404 for an unknown item and 401 without a token', async () => {
    expect((await patch(UNKNOWN_ID, { task: 'x' }, org.admin.accessToken)).status).toBe(404);
    expect((await patch(itemId, { task: 'x' })).status).toBe(401);
  });

  it('PATCH returns 403 for a cleaner and for another org\'s admin', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await patch(itemId, { task: 'x' }, org.cleaner.accessToken)).status).toBe(403);
    expect((await patch(itemId, { task: 'x' }, other.admin.accessToken)).status).toBe(403);
  });

  it('PATCH returns 400 for a blank task', async () => {
    const res = await patch(itemId, { task: '' }, org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Task cannot be empty');
  });

  it('PATCH updates the task text', async () => {
    const res = await patch(itemId, { task: ' Dust shelves ' }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: itemId, task: 'Dust shelves' });
  });

  it('DELETE removes the item', async () => {
    const res = await del(itemId, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const { data } = await db.from('checklist_line_items').select('id').eq('id', itemId);
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration -- "src/app/api/checklists/\[id\]/items/route.integration.test.ts" "src/app/api/checklist-items"`
Expected: FAIL, cannot resolve `./route` in both.

- [ ] **Step 3: Write the two routes**

```ts
// src/app/api/checklists/[id]/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeChecklist } from '@/lib/catalog/authorizeCatalog';
import { parseItemsCreate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/checklists/:id/items
 * Adds one task ({ task }) or many ({ tasks }). `position` is left null on
 * purpose: the client sort places null positions last by created_at, so new
 * tasks read as appended without jumping above the trigger-seeded default
 * items, which also have null positions.
 * Returns 201 { success: true, data: ChecklistLineItem[] } in the order given.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseItemsCreate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('checklist_line_items')
      .insert(parsed.value.tasks.map((task) => ({ checklist_id: id, task })))
      .select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data: data ?? [] }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

```ts
// src/app/api/checklist-items/[itemId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeLineItem } from '@/lib/catalog/authorizeCatalog';
import { parseItemUpdate } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ itemId: string }> };

/**
 * PATCH /api/checklist-items/:itemId
 * Body: { task }. The org is resolved from the item itself (item -> checklist
 * -> service), which is why this route is keyed by item id alone.
 * Returns { success: true, data: ChecklistLineItem }.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { itemId } = await params;
    const auth = await authorizeLineItem(request, itemId);
    if (!auth.ok) return auth.response;

    const parsed = parseItemUpdate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('checklist_line_items')
      .update({ task: parsed.value.task })
      .eq('id', itemId)
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to update task' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

/** DELETE /api/checklist-items/:itemId. Returns { success: true }. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { itemId } = await params;
    const auth = await authorizeLineItem(request, itemId);
    if (!auth.ok) return auth.response;

    const { error } = await supabaseAdmin.from('checklist_line_items').delete().eq('id', itemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:integration -- "src/app/api/checklists/\[id\]/items/route.integration.test.ts" "src/app/api/checklist-items"`
Expected: 4 + 5 passed.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/checklists/[id]/items/route.ts" "src/app/api/checklists/[id]/items/route.integration.test.ts" "src/app/api/checklist-items/[itemId]/route.ts" "src/app/api/checklist-items/[itemId]/route.integration.test.ts"
git commit -m "feat(checklists): line item routes (add, edit, delete)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 10: `PUT /api/checklists/[id]/items/order`

**Files:**
- Create: `src/app/api/checklists/[id]/items/order/route.ts`
- Test: `src/app/api/checklists/[id]/items/order/route.integration.test.ts`

**Interfaces:**
- Consumes: `authorizeChecklist` (Task 7); `parseOrder`, `orderMatchesItems` (Task 6).
- Produces: `PUT /api/checklists/[id]/items/order` `{ item_ids }` → `200 { success: true, data: ChecklistLineItem[] }` ordered by the new positions; `400` when the ids are not exactly the checklist's items.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/checklists/[id]/items/order/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PUT } from './route';
import { callRoute, bearerHeader } from '../../../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../../tests/helpers/supabase';

type Item = { id: string; task: string; position: number | null };
type Body = { success?: boolean; data?: Item[]; error?: string };

const db = createTestSupabaseClient();
const FOREIGN_ID = '00000000-0000-4000-8000-000000000000';

async function seedChecklistWithItems(orgId: string) {
  const { data: svc, error: svcErr } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (svcErr) throw svcErr;
  const { data: cl, error: clErr } = await db
    .from('checklists')
    .insert({ service_type_id: svc.id, name: 'Basic', price_adder: 0 })
    .select('id')
    .single();
  if (clErr) throw clErr;
  const { data: items, error: itemErr } = await db
    .from('checklist_line_items')
    .insert([
      { checklist_id: cl.id, task: 'a', position: 0 },
      { checklist_id: cl.id, task: 'b', position: 1 },
      { checklist_id: cl.id, task: 'c', position: 2 },
    ])
    .select('id, task');
  if (itemErr) throw itemErr;
  const byTask = Object.fromEntries((items as Item[]).map((i) => [i.task, i.id])) as Record<string, string>;
  return { checklistId: cl.id as string, ids: byTask };
}

describe('PUT /api/checklists/[id]/items/order', () => {
  let org: TestOrgFixture;
  let checklistId: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    org = await withTestOrg();
    ({ checklistId, ids } = await seedChecklistWithItems(org.organizationId));
  });
  afterEach(async () => {
    await org.cleanup();
  });

  const put = (id: string, body: unknown, token?: string) =>
    callRoute<Body>((req) => PUT(req, { params: Promise.resolve({ id }) }), {
      method: 'PUT', url: `http://test/api/checklists/${id}/items/order`, headers: token ? bearerHeader(token) : {}, body,
    });

  it('returns 403 for a cleaner', async () => {
    expect((await put(checklistId, { item_ids: [ids.c, ids.a, ids.b] }, org.cleaner.accessToken)).status).toBe(403);
  });

  it('returns 400 when an item is missing, foreign, or duplicated', async () => {
    const mismatch = 'item_ids must list every task in this checklist exactly once';
    expect((await put(checklistId, { item_ids: [ids.a, ids.b] }, org.admin.accessToken)).body.error).toBe(mismatch);
    expect((await put(checklistId, { item_ids: [ids.a, ids.b, FOREIGN_ID] }, org.admin.accessToken)).body.error).toBe(mismatch);
    expect((await put(checklistId, { item_ids: [ids.a, ids.a, ids.b] }, org.admin.accessToken)).body.error).toBe(
      'item_ids must be a list of unique item ids',
    );
  });

  it('writes the new positions and returns the items in that order', async () => {
    const res = await put(checklistId, { item_ids: [ids.c, ids.a, ids.b] }, org.admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data!.map((i) => [i.task, i.position])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
    const { data } = await db
      .from('checklist_line_items')
      .select('task, position')
      .eq('checklist_id', checklistId)
      .order('position', { ascending: true });
    expect(data).toEqual([{ task: 'c', position: 0 }, { task: 'a', position: 1 }, { task: 'b', position: 2 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- "src/app/api/checklists/\[id\]/items/order/route.integration.test.ts"`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/checklists/[id]/items/order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeChecklist } from '@/lib/catalog/authorizeCatalog';
import { orderMatchesItems, parseOrder } from '@/lib/catalog/checklistInput';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/checklists/:id/items/order
 * Body: { item_ids: string[] }, a permutation of the checklist's items. Writes
 * position = index for each (sequentially, as the client did) and returns the
 * items ordered by the new positions: { success: true, data: ChecklistLineItem[] }.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const auth = await authorizeChecklist(request, id);
    if (!auth.ok) return auth.response;

    const parsed = parseOrder(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data: existing, error: loadError } = await supabaseAdmin
      .from('checklist_line_items')
      .select('id')
      .eq('checklist_id', id);
    if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
    const existingIds = (existing ?? []).map((row) => row.id as string);
    if (!orderMatchesItems(parsed.value.item_ids, existingIds)) {
      return NextResponse.json(
        { error: 'item_ids must list every task in this checklist exactly once' },
        { status: 400 },
      );
    }

    for (const [index, itemId] of parsed.value.item_ids.entries()) {
      const { error } = await supabaseAdmin
        .from('checklist_line_items')
        .update({ position: index })
        .eq('id', itemId)
        .eq('checklist_id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data, error } = await supabaseAdmin
      .from('checklist_line_items')
      .select('*')
      .eq('checklist_id', id)
      .order('position', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- "src/app/api/checklists/\[id\]/items/order/route.integration.test.ts"`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/checklists/[id]/items/order/route.ts" "src/app/api/checklists/[id]/items/order/route.integration.test.ts"
git commit -m "feat(checklists): PUT /api/checklists/[id]/items/order reorders tasks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 11: `checklists-api.ts` and the `useChecklists` rewire

**Files:**
- Create: `src/hooks/checklists-api.ts`
- Modify: `src/hooks/useChecklists.ts` (the nine exported write functions under the two "CRUD FUNCTIONS" banners; the hook body and its `apply*` helpers stay)

**Interfaces:**
- Consumes: `apiFetch` (Task 1); routes from Tasks 7 to 10.
- Produces: seven `*Api` wrappers. All nine exported hook functions keep their names, parameters, and `{ success, data?, error? }` return shapes, so `OperatorServices.tsx` does not change.

- [ ] **Step 1: Write the API module**

```ts
// src/hooks/checklists-api.ts
import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { Checklist, ChecklistLineItem, ChecklistWithItems } from '@/types';

export const createChecklistApi = (
  serviceTypeId: string,
  body: { name: string; price_adder: number; items?: string[] },
): Promise<ApiResult<ChecklistWithItems>> =>
  apiFetch<ChecklistWithItems>(`/api/services/${serviceTypeId}/checklists`, { method: 'POST', body });

export const updateChecklistApi = (
  checklistId: string,
  body: { name?: string; price_adder?: number },
): Promise<ApiResult<Checklist>> =>
  apiFetch<Checklist>(`/api/checklists/${checklistId}`, { method: 'PATCH', body });

export const deleteChecklistApi = (checklistId: string): Promise<ApiResult<void>> =>
  apiFetch<void>(`/api/checklists/${checklistId}`, { method: 'DELETE' });

export const createLineItemsApi = (
  checklistId: string,
  body: { task: string } | { tasks: string[] },
): Promise<ApiResult<ChecklistLineItem[]>> =>
  apiFetch<ChecklistLineItem[]>(`/api/checklists/${checklistId}/items`, { method: 'POST', body });

export const updateLineItemApi = (itemId: string, body: { task: string }): Promise<ApiResult<ChecklistLineItem>> =>
  apiFetch<ChecklistLineItem>(`/api/checklist-items/${itemId}`, { method: 'PATCH', body });

export const deleteLineItemApi = (itemId: string): Promise<ApiResult<void>> =>
  apiFetch<void>(`/api/checklist-items/${itemId}`, { method: 'DELETE' });

export const reorderLineItemsApi = (checklistId: string, itemIds: string[]): Promise<ApiResult<ChecklistLineItem[]>> =>
  apiFetch<ChecklistLineItem[]>(`/api/checklists/${checklistId}/items/order`, {
    method: 'PUT',
    body: { item_ids: itemIds },
  });
```

- [ ] **Step 2: Rewire the nine functions in `useChecklists.ts`**

Add the import near the top:

```ts
import {
  createChecklistApi,
  createLineItemsApi,
  deleteChecklistApi,
  deleteLineItemApi,
  reorderLineItemsApi,
  updateChecklistApi,
  updateLineItemApi,
} from './checklists-api';
```

Replace everything from the `// CHECKLIST CRUD FUNCTIONS` banner to just before `export type { Checklist, ChecklistLineItem, ChecklistWithItems };` with:

```ts
// ============================================================================
// CHECKLIST CRUD FUNCTIONS (writes go through the API routes; reads stay direct)
// ============================================================================

/** Create a new checklist for a service type. */
export async function createChecklist(
  serviceTypeId: string,
  name: string = 'New Checklist',
  priceAdder: number = 0
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  const res = await createChecklistApi(serviceTypeId, { name: name.trim() || 'New Checklist', price_adder: priceAdder });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/** Update a checklist's name and price adder. */
export async function updateChecklist(
  checklistId: string,
  name: string,
  priceAdder: number
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  if (!name.trim()) return { success: false, error: 'Checklist name cannot be empty' };
  const res = await updateChecklistApi(checklistId, { name: name.trim(), price_adder: priceAdder });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/** Delete a checklist (line items are cascade deleted). */
export async function deleteChecklist(
  checklistId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await deleteChecklistApi(checklistId);
  return res.success ? { success: true } : { success: false, error: res.error };
}

// ============================================================================
// LINE ITEM CRUD FUNCTIONS
// ============================================================================

/** Create a new line item in a checklist. */
export async function createLineItem(
  checklistId: string,
  task: string
): Promise<{ success: boolean; data?: ChecklistLineItem; error?: string }> {
  if (!task.trim()) return { success: false, error: 'Task cannot be empty' };
  const res = await createLineItemsApi(checklistId, { task: task.trim() });
  return res.success ? { success: true, data: res.data[0] } : { success: false, error: res.error };
}

/** Update a line item's task text. */
export async function updateLineItem(
  lineItemId: string,
  task: string
): Promise<{ success: boolean; data?: ChecklistLineItem; error?: string }> {
  if (!task.trim()) return { success: false, error: 'Task cannot be empty' };
  const res = await updateLineItemApi(lineItemId, { task: task.trim() });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/** Delete a line item. */
export async function deleteLineItem(
  lineItemId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await deleteLineItemApi(lineItemId);
  return res.success ? { success: true } : { success: false, error: res.error };
}

/** Reorder line items in a checklist. `orderedIds` must be every item exactly once. */
export async function reorderLineItems(
  checklistId: string,
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const res = await reorderLineItemsApi(checklistId, orderedIds);
  return res.success ? { success: true } : { success: false, error: res.error };
}

/**
 * Bulk-create line items from pasted text. Each non-blank line becomes one task,
 * appended after existing items (position stays NULL so they sort last by created_at).
 */
export async function createLineItems(
  checklistId: string,
  tasks: string[]
): Promise<{ success: boolean; data?: ChecklistLineItem[]; error?: string }> {
  const cleaned = tasks.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return { success: false, error: 'No tasks to add' };
  const res = await createLineItemsApi(checklistId, { tasks: cleaned });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/**
 * Clone a checklist (tier) within the same service, including all its line items
 * in order. The source is read here (reads stay direct); the copy is created by
 * the checklist route, so the copy is named "<name> (copy)" and carries the
 * source's price, which places it right after the source in the locked order.
 */
export async function duplicateChecklist(
  checklistId: string
): Promise<{ success: boolean; data?: ChecklistWithItems; error?: string }> {
  const { data: source, error: srcError } = await supabase
    .from('checklists')
    .select('*, checklist_line_items (*)')
    .eq('id', checklistId)
    .single();
  if (srcError || !source) {
    return { success: false, error: srcError?.message ?? 'Checklist not found' };
  }
  const src = source as ChecklistWithItems;
  const items = [...(src.checklist_line_items ?? [])].sort((a, b) => {
    if (a.position === null && b.position === null) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return (a.position ?? 0) - (b.position ?? 0);
  });
  const res = await createChecklistApi(src.service_type_id, {
    name: `${src.name} (copy)`,
    price_adder: Number(src.price_adder) || 0,
    items: items.map((it) => it.task),
  });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}
```

`supabase` stays imported (the hook's query and `duplicateChecklist`'s read use it).

- [ ] **Step 3: Run the gates**

Run: `npx tsc --noEmit 2>&1 | grep -E "useChecklists|checklists-api|OperatorServices|api/checklists|api/checklist-items|authorizeCatalog|resolveCatalogOrg"`
Expected: no lines.

Run: `npm run lint`
Expected: no errors in the touched files.

Run: `npm run test:unit -- src/lib/catalog`
Expected: pass.

Run: `npm run test:integration -- src/app/api/services src/app/api/checklists src/app/api/checklist-items`
Expected: pass.

- [ ] **Step 4: Smoke it in the browser**

On the Services page, open a service and: add a checklist tier, rename it and change its price, add one task, paste three tasks, edit a task, drag to reorder, delete a task, duplicate the tier, delete the tier. Each action keeps its existing toast and instant cache update.

- [ ] **Step 5: Commit, push, open PR B**

```bash
git add src/hooks/checklists-api.ts src/hooks/useChecklists.ts
git commit -m "feat(checklists): route the checklist and task writes through the API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
git push -u origin feat/phase1a-checklist-routes
gh pr create --base feat/phase1a-services-routes --title "feat(checklists): checklist and task writes go through API routes (Phase 1a, PR B)" --body "$(cat <<'EOF'
## Summary
- New routes: `POST /api/services/[id]/checklists`, `PATCH|DELETE /api/checklists/[id]`, `POST /api/checklists/[id]/items`, `PUT /api/checklists/[id]/items/order`, `PATCH|DELETE /api/checklist-items/[itemId]`. All resolve the org from the target row and require owner/admin or a manager with `can_manage_services`.
- `useChecklists.ts` write functions call the routes; the hook, its cache helpers, and `OperatorServices.tsx` are unchanged.
- Stacks on PR A (shared `apiFetch`, parse primitives, catalog resolvers).
- Spec §12.2 (line-item route path amended to `/api/checklist-items/[itemId]`). Plan Tasks 6 to 11.

## Test plan
- [x] unit: `checklistInput`
- [x] integration: five route files
- [x] manual: full tier and task flow on the Services page

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
EOF
)"
```

---

# PR C: operator booking and homeowner add-home (`feat/phase1a-booking-property-routes`)

Start: `git checkout -b feat/phase1a-booking-property-routes feat/phase1a-checklist-routes` (stacks on B).

### Task 12: move `selfPayCleanerBlockReason` to lib, write the booking body parser

**Files:**
- Modify: `src/lib/payments/isCleanerPayable.ts` (append the function)
- Modify: `src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts` (re-export it)
- Create: `src/lib/appointments/parseOperatorBooking.ts`
- Test: `src/lib/appointments/parseOperatorBooking.test.ts` (the existing `deriveOperatorBooking.test.ts` keeps covering the moved function through the re-export)

**Interfaces:**
- Consumes: `asRecord`, `isUuid`, `parseMoney`, `parseOptionalText`, `ParseResult` (Task 2); `isCleanerPayable`, `CleanerPayoutFields` (exist).
- Produces: `selfPayCleanerBlockReason(c: CleanerPayoutFields): string | null` importable from `@/lib/payments/isCleanerPayable`; `parseOperatorBookingBody(body: unknown): ParseResult<OperatorBookingInput>`; `isYMD`, `isHMM`; `MAX_BOOKING_SLOTS = 3`; types `OperatorBookingInput`, `OperatorAppointmentInput`, `BookingSlotInput`.

- [ ] **Step 1: Move the block-reason helper**

Append to `src/lib/payments/isCleanerPayable.ts`, verbatim from `deriveOperatorBooking.ts`:

```ts
/**
 * Why a cleaner cannot be offered a company-pays (self-pay) job, or null when they can.
 *
 * A self-pay job's only money movement is company card -> cleaner Connect account, so the
 * picker (and now POST /api/appointments) refuses cleaners settlement could not pay. The
 * yes/no comes from isCleanerPayable (the same predicate settleSelfPay uses); the text says
 * what to fix, in the same words the Cleaners page uses for the matching state.
 */
export function selfPayCleanerBlockReason(c: CleanerPayoutFields): string | null {
  if (isCleanerPayable(c)) return null;
  if (!c.payout_configured_at) return 'Pay not set';
  if (c.payout_model === 'hourly_external') return 'Paid off platform';
  if (!c.stripe_connect_account_id) return 'No Stripe payout account yet';
  if (c.stripe_connect_onboarding_complete !== true) return 'Stripe payout setup not finished';
  if (c.payout_model === 'flat') return 'Flat rate not set';
  return 'Pay set to 0%';
}
```

In `deriveOperatorBooking.ts`, delete the `selfPayCleanerBlockReason` function and its JSDoc, and add at the top (after the existing imports):

```ts
export { selfPayCleanerBlockReason } from '@/lib/payments/isCleanerPayable';
```

If `isCleanerPayable` and `CleanerPayoutFields` are no longer referenced in that file, remove them from its import line (lint will say).

Run: `npm run test:unit -- src/components/redesign/bookings/new-booking/deriveOperatorBooking.test.ts`
Expected: pass, unchanged (the test imports the name from `./deriveOperatorBooking`, which now re-exports it).

- [ ] **Step 2: Write the failing parser test**

```ts
// src/lib/appointments/parseOperatorBooking.test.ts
import { describe, it, expect } from 'vitest';
import { isHMM, isYMD, parseOperatorBookingBody } from './parseOperatorBooking';

const ORG = '5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
const HOME = '11111111-1111-4111-8111-111111111111';
const PROP = '22222222-2222-4222-8222-222222222222';
const SVC = '33333333-3333-4333-8333-333333333333';
const CLEANER = '44444444-4444-4444-8444-444444444444';

const appointment = {
  homeowner_id: HOME,
  cleaner_id: null,
  property_id: PROP,
  service_type_id: SVC,
  checklist_id: null,
  scheduled_date: '2026-10-01',
  scheduled_time: '10:00',
  duration_minutes: 90,
  total_price: '150.5',
  price_override_enabled: false,
  price_override_total: null,
  special_requests: '  Gate code 1234 ',
  payment_method_id: 'pm_abc',
  is_self_pay: false,
  // fields the client also sends and the route ignores:
  organization_id: ORG,
  status: 'confirmed',
  cleaner_confirmation_status: 'accepted',
  response_deadline: '2020-01-01T00:00:00.000Z',
};
const slots = [{ slot_index: 0, scheduled_date: '2026-10-01', scheduled_time: '10:00' }];
const body = (a: Record<string, unknown> = {}, s: unknown = slots) => ({
  organization_id: ORG,
  appointment: { ...appointment, ...a },
  slots: s,
});

describe('isYMD / isHMM', () => {
  it('match the formats the booking form emits', () => {
    expect(isYMD('2026-10-01')).toBe(true);
    expect(isYMD('10/01/2026')).toBe(false);
    expect(isHMM('10:00')).toBe(true);
    expect(isHMM('10:00:00')).toBe(true);
    expect(isHMM('10am')).toBe(false);
  });
});

describe('parseOperatorBookingBody', () => {
  it('normalizes a valid customer-billed body and drops the ignored fields', () => {
    const r = parseOperatorBookingBody(body());
    expect(r).toEqual({
      ok: true,
      value: {
        organization_id: ORG,
        appointment: {
          homeowner_id: HOME,
          cleaner_id: null,
          property_id: PROP,
          service_type_id: SVC,
          checklist_id: null,
          scheduled_date: '2026-10-01',
          scheduled_time: '10:00',
          duration_minutes: 90,
          total_price: 150.5,
          price_override_enabled: false,
          price_override_total: null,
          special_requests: 'Gate code 1234',
          payment_method_id: 'pm_abc',
          is_self_pay: false,
        },
        slots,
      },
    });
  });

  it('forces payment_method_id to null on a self-pay booking and allows no customer', () => {
    const r = parseOperatorBookingBody(body({ is_self_pay: true, homeowner_id: null, cleaner_id: CLEANER }));
    expect(r.ok && r.value.appointment).toMatchObject({ is_self_pay: true, homeowner_id: null, payment_method_id: null, cleaner_id: CLEANER });
  });

  it('accepts up to three slots that start with the appointment time', () => {
    const three = [
      { slot_index: 0, scheduled_date: '2026-10-01', scheduled_time: '10:00' },
      { slot_index: 1, scheduled_date: '2026-10-02', scheduled_time: '13:00' },
      { slot_index: 2, scheduled_date: '2026-10-03', scheduled_time: '09:30' },
    ];
    expect(parseOperatorBookingBody(body({}, three))).toMatchObject({ ok: true, value: { slots: three } });
  });

  it.each([
    [{ organization_id: 'x' }, 'organization_id is required'],
    [{ appointment: null }, 'appointment is required'],
    [{ appointment: { ...appointment, property_id: null } }, 'A property is required'],
    [{ appointment: { ...appointment, service_type_id: 'svc' } }, 'A service is required'],
    [{ appointment: { ...appointment, checklist_id: 'x' } }, 'checklist_id must be an id'],
    [{ appointment: { ...appointment, is_self_pay: 'no' } }, 'is_self_pay must be true or false'],
    [{ appointment: { ...appointment, homeowner_id: null } }, 'A customer is required unless the company pays for this job'],
    [{ appointment: { ...appointment, scheduled_date: '10/01/2026' } }, 'scheduled_date must be YYYY-MM-DD'],
    [{ appointment: { ...appointment, scheduled_time: '10am' } }, 'scheduled_time must be HH:MM'],
    [{ appointment: { ...appointment, duration_minutes: 0 } }, 'Duration must be a whole number of minutes greater than 0'],
    [{ appointment: { ...appointment, total_price: -1 } }, 'Total price must be a number of 0 or more'],
    [{ appointment: { ...appointment, price_override_enabled: true, price_override_total: null } }, 'Price override amount is required'],
    [{ appointment: { ...appointment, payment_method_id: 7 } }, 'payment_method_id must be text'],
    [{ slots: [] }, 'slots must contain 1 to 3 offered times'],
    [{ slots: [slots[0], slots[0], slots[0], slots[0]] }, 'slots must contain 1 to 3 offered times'],
    [{ slots: [{ slot_index: 0, scheduled_date: 'x', scheduled_time: '10:00' }] }, 'each slot needs a valid scheduled_date (YYYY-MM-DD) and scheduled_time (HH:MM)'],
    [{ slots: [{ slot_index: 1, scheduled_date: '2026-10-01', scheduled_time: '10:00' }] }, 'slot_index must run from 0 in order'],
    [{ slots: [{ slot_index: 0, scheduled_date: '2026-10-02', scheduled_time: '10:00' }] }, 'The first slot must match the appointment date and time'],
  ] as const)('rejects %j', (override, error) => {
    expect(parseOperatorBookingBody({ ...body(), ...override })).toEqual({ ok: false, error });
  });

  it('rejects a non-object body', () => {
    expect(parseOperatorBookingBody('x')).toEqual({ ok: false, error: 'Request body must be a JSON object' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit -- src/lib/appointments/parseOperatorBooking.test.ts`
Expected: FAIL, cannot resolve `./parseOperatorBooking`.

- [ ] **Step 4: Write the parser**

```ts
// src/lib/appointments/parseOperatorBooking.ts
import { asRecord, isUuid, parseMoney, parseOptionalText, type ParseResult } from '@/lib/catalog/parse';

export const MAX_BOOKING_SLOTS = 3;

export function isYMD(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
export function isHMM(s: unknown): s is string {
  return typeof s === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

export interface BookingSlotInput {
  slot_index: number;
  scheduled_date: string;
  scheduled_time: string;
}

/** The subset of buildBookingInsert's `appointment` the route accepts. Everything else is ignored. */
export interface OperatorAppointmentInput {
  homeowner_id: string | null;
  cleaner_id: string | null;
  property_id: string;
  service_type_id: string;
  checklist_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  total_price: number;
  price_override_enabled: boolean;
  price_override_total: number | null;
  special_requests: string | null;
  payment_method_id: string | null;
  is_self_pay: boolean;
}

export interface OperatorBookingInput {
  organization_id: string;
  appointment: OperatorAppointmentInput;
  slots: BookingSlotInput[];
}

function optionalUuid(v: unknown, label: string): ParseResult<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (!isUuid(v)) return { ok: false, error: `${label} must be an id` };
  return { ok: true, value: v };
}

function parseSlots(v: unknown, first: { scheduled_date: string; scheduled_time: string }): ParseResult<BookingSlotInput[]> {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_BOOKING_SLOTS) {
    return { ok: false, error: `slots must contain 1 to ${MAX_BOOKING_SLOTS} offered times` };
  }
  const out: BookingSlotInput[] = [];
  for (const [idx, raw] of v.entries()) {
    const s = asRecord(raw);
    if (!s || !isYMD(s.scheduled_date) || !isHMM(s.scheduled_time)) {
      return { ok: false, error: 'each slot needs a valid scheduled_date (YYYY-MM-DD) and scheduled_time (HH:MM)' };
    }
    if (s.slot_index !== idx) return { ok: false, error: 'slot_index must run from 0 in order' };
    out.push({ slot_index: idx, scheduled_date: s.scheduled_date, scheduled_time: s.scheduled_time });
  }
  if (out[0].scheduled_date !== first.scheduled_date || out[0].scheduled_time !== first.scheduled_time) {
    return { ok: false, error: 'The first slot must match the appointment date and time' };
  }
  return { ok: true, value: out };
}

export function parseOperatorBookingBody(body: unknown): ParseResult<OperatorBookingInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  if (!isUuid(r.organization_id)) return { ok: false, error: 'organization_id is required' };
  const a = asRecord(r.appointment);
  if (!a) return { ok: false, error: 'appointment is required' };

  if (!isUuid(a.property_id)) return { ok: false, error: 'A property is required' };
  if (!isUuid(a.service_type_id)) return { ok: false, error: 'A service is required' };
  const checklistId = optionalUuid(a.checklist_id, 'checklist_id');
  if (!checklistId.ok) return checklistId;
  const homeownerId = optionalUuid(a.homeowner_id, 'homeowner_id');
  if (!homeownerId.ok) return homeownerId;
  const cleanerId = optionalUuid(a.cleaner_id, 'cleaner_id');
  if (!cleanerId.ok) return cleanerId;

  if (typeof a.is_self_pay !== 'boolean') return { ok: false, error: 'is_self_pay must be true or false' };
  if (!a.is_self_pay && !homeownerId.value) {
    return { ok: false, error: 'A customer is required unless the company pays for this job' };
  }

  if (!isYMD(a.scheduled_date)) return { ok: false, error: 'scheduled_date must be YYYY-MM-DD' };
  if (!isHMM(a.scheduled_time)) return { ok: false, error: 'scheduled_time must be HH:MM' };
  const duration = typeof a.duration_minutes === 'string' ? Number(a.duration_minutes) : a.duration_minutes;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0) {
    return { ok: false, error: 'Duration must be a whole number of minutes greater than 0' };
  }
  const totalPrice = parseMoney(a.total_price, 'Total price');
  if (!totalPrice.ok) return totalPrice;

  if (typeof a.price_override_enabled !== 'boolean') {
    return { ok: false, error: 'price_override_enabled must be true or false' };
  }
  let overrideTotal: number | null = null;
  if (a.price_override_total !== undefined && a.price_override_total !== null) {
    const p = parseMoney(a.price_override_total, 'Price override');
    if (!p.ok) return p;
    overrideTotal = p.value;
  }
  if (a.price_override_enabled && overrideTotal === null) {
    return { ok: false, error: 'Price override amount is required' };
  }

  const special = parseOptionalText(a.special_requests, 'Special requests');
  if (!special.ok) return special;

  let paymentMethodId: string | null = null;
  if (!a.is_self_pay && a.payment_method_id !== undefined && a.payment_method_id !== null) {
    if (typeof a.payment_method_id !== 'string') return { ok: false, error: 'payment_method_id must be text' };
    paymentMethodId = a.payment_method_id.trim() || null;
  }

  const slots = parseSlots(r.slots, { scheduled_date: a.scheduled_date, scheduled_time: a.scheduled_time });
  if (!slots.ok) return slots;

  return {
    ok: true,
    value: {
      organization_id: r.organization_id,
      appointment: {
        homeowner_id: homeownerId.value,
        cleaner_id: cleanerId.value,
        property_id: a.property_id,
        service_type_id: a.service_type_id,
        checklist_id: checklistId.value,
        scheduled_date: a.scheduled_date,
        scheduled_time: a.scheduled_time,
        duration_minutes: duration,
        total_price: totalPrice.value,
        price_override_enabled: a.price_override_enabled,
        price_override_total: overrideTotal,
        special_requests: special.value,
        payment_method_id: paymentMethodId,
        is_self_pay: a.is_self_pay,
      },
      slots: slots.value,
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit -- src/lib/appointments/parseOperatorBooking.test.ts src/components/redesign/bookings/new-booking/deriveOperatorBooking.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments/isCleanerPayable.ts src/components/redesign/bookings/new-booking/deriveOperatorBooking.ts src/lib/appointments/parseOperatorBooking.ts src/lib/appointments/parseOperatorBooking.test.ts
git commit -m "feat(bookings): operator booking body parser; selfPayCleanerBlockReason moves to lib

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 13: `POST /api/appointments`

**Files:**
- Create: `src/app/api/appointments/route.ts` (the folder exists with sub-routes; there is no `route.ts` in it today)
- Test: `src/app/api/appointments/route.integration.test.ts`

**Interfaces:**
- Consumes: `parseOperatorBookingBody` (Task 12); `selfPayCleanerBlockReason` from `@/lib/payments/isCleanerPayable` (Task 12); `computeResponseDeadlineISO(date, time)` from `@/lib/computeResponseDeadline` (exists); `requireManagerPermission` with `'can_edit_bookings'`.
- Produces: `POST /api/appointments` → `201 { success: true, data: { id } }`.

Validation order after auth: property (404, then 403 wrong org, then 400 owner mismatch), customer membership (400), service (404, 403), checklist (400), cleaner (404, 403, then the self-pay gate 400). The route inserts with `status: 'pending'`, `cleaner_confirmation_status: 'awaiting'`, and a server-computed `response_deadline`. Offered slots are inserted only when more than one was given (a lone primary is already the appointment's date and time); a slot insert failure is logged and does not fail the booking, matching the old client.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/appointments/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: { id: string }; error?: string };

const db = createTestSupabaseClient();

async function seedService(orgId: string) {
  const { data, error } = await db
    .from('service_types')
    .insert({ organization_id: orgId, name: 'Std', base_price: 100, duration_minutes: 60, service_type: 'regular' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function seedProperty(orgId: string, ownerId: string | null) {
  const { data, error } = await db
    .from('properties')
    .insert({
      organization_id: orgId,
      owner_id: ownerId,
      name: 'Test Property',
      address: '1 Test Lane',
      city: 'Testville',
      state: 'TS',
      zip_code: '00000',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function defaultChecklistOf(serviceId: string) {
  const { data, error } = await db.from('checklists').select('id').eq('service_type_id', serviceId).limit(1).single();
  if (error) throw error;
  return data.id as string;
}

async function purgeOrg(orgId: string) {
  await db.from('appointments').delete().eq('organization_id', orgId);
  await db.from('properties').delete().eq('organization_id', orgId);
}

describe('POST /api/appointments', () => {
  let org: TestOrgFixture;
  let serviceId: string;
  let propertyId: string;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
    serviceId = await seedService(org.organizationId);
    propertyId = await seedProperty(org.organizationId, org.homeowner.userId);
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await purgeOrg(org.organizationId);
    await org.cleanup();
  });

  const appointment = (over: Record<string, unknown> = {}) => ({
    homeowner_id: org.homeowner.userId,
    cleaner_id: null,
    property_id: propertyId,
    service_type_id: serviceId,
    checklist_id: null,
    scheduled_date: '2026-10-01',
    scheduled_time: '10:00',
    duration_minutes: 60,
    total_price: 100,
    price_override_enabled: false,
    price_override_total: null,
    special_requests: null,
    payment_method_id: null,
    is_self_pay: false,
    ...over,
  });
  const primary = { slot_index: 0, scheduled_date: '2026-10-01', scheduled_time: '10:00' };
  const body = (over: Record<string, unknown> = {}, slots: unknown[] = [primary]) => ({
    organization_id: org.organizationId,
    appointment: appointment(over),
    slots,
  });
  const post = (b: unknown, token?: string) =>
    callRoute<Body>(POST, { method: 'POST', url: 'http://test/api/appointments', headers: token ? bearerHeader(token) : {}, body: b });

  it('returns 401 without a token and 400 on an invalid body', async () => {
    expect((await post(body())).status).toBe(401);
    const res = await post(body({ property_id: null }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A property is required');
  });

  it('returns 403 for a cleaner, a manager without can_edit_bookings, and another org\'s admin', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: false });
    cleanups.push(() => mgr.cleanup());
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await post(body(), org.cleaner.accessToken)).status).toBe(403);
    expect((await post(body(), mgr.accessToken)).status).toBe(403);
    expect((await post(body(), other.admin.accessToken)).status).toBe(403);
  });

  it('admin creates a pending booking with a server-side deadline and no slot rows for a single slot', async () => {
    const res = await post(body(), org.admin.accessToken);
    expect(res.status).toBe(201);
    const id = res.body.data!.id;
    const { data: row } = await db
      .from('appointments')
      .select('organization_id, status, cleaner_confirmation_status, response_deadline, homeowner_id, total_price, is_self_pay')
      .eq('id', id)
      .single();
    expect(row).toMatchObject({
      organization_id: org.organizationId,
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      homeowner_id: org.homeowner.userId,
      is_self_pay: false,
    });
    expect(row!.response_deadline).not.toBeNull();
    expect(Number(row!.total_price)).toBe(100);
    const { count } = await db.from('appointment_requested_slots').select('id', { count: 'exact', head: true }).eq('appointment_id', id);
    expect(count).toBe(0);
  });

  it('manager with can_edit_bookings creates a booking', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_bookings: true });
    cleanups.push(() => mgr.cleanup());
    expect((await post(body(), mgr.accessToken)).status).toBe(201);
  });

  it('records offered slots when more than one is given', async () => {
    const slots = [
      primary,
      { slot_index: 1, scheduled_date: '2026-10-02', scheduled_time: '13:00' },
      { slot_index: 2, scheduled_date: '2026-10-03', scheduled_time: '09:30' },
    ];
    const res = await post(body({}, slots), org.admin.accessToken);
    expect(res.status).toBe(201);
    const { data } = await db
      .from('appointment_requested_slots')
      .select('slot_index, scheduled_date')
      .eq('appointment_id', res.body.data!.id)
      .order('slot_index', { ascending: true });
    expect(data).toEqual([
      { slot_index: 0, scheduled_date: '2026-10-01' },
      { slot_index: 1, scheduled_date: '2026-10-02' },
      { slot_index: 2, scheduled_date: '2026-10-03' },
    ]);
  });

  it('rejects a property from another org (403) and a property that is not the customer\'s (400)', async () => {
    const other = await withTestOrg();
    cleanups.push(async () => {
      await purgeOrg(other.organizationId);
      await other.cleanup();
    });
    const foreignProperty = await seedProperty(other.organizationId, other.homeowner.userId);
    const r1 = await post(body({ property_id: foreignProperty }), org.admin.accessToken);
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe('Property is in a different organization');

    const orgOwned = await seedProperty(org.organizationId, null);
    const r2 = await post(body({ property_id: orgOwned }), org.admin.accessToken);
    expect(r2.status).toBe(400);
    expect(r2.body.error).toBe('Property does not belong to the selected customer');
  });

  it('rejects a customer who is not a homeowner in the org', async () => {
    const res = await post(body({ homeowner_id: org.cleaner.userId }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Customer is not a homeowner in this organization');
  });

  it('rejects a checklist that belongs to another service', async () => {
    const otherService = await seedService(org.organizationId);
    const wrongChecklist = await defaultChecklistOf(otherService);
    const res = await post(body({ checklist_id: wrongChecklist }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Checklist does not match the selected service type');
  });

  it('rejects a cleaner from another org', async () => {
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    const res = await post(body({ cleaner_id: other.cleaner.userId }), org.admin.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Cleaner is in a different organization');
  });

  it('refuses a company-paid job for a cleaner settlement could not pay', async () => {
    // The default fixture cleaner has pay configured but no Connect account.
    const res = await post(body({ is_self_pay: true, cleaner_id: org.cleaner.userId }), org.admin.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cleaner cannot be offered a company-paid job: No Stripe payout account yet');
  });

  it('creates a company-paid booking on an org-owned property with a payable cleaner and no customer', async () => {
    const payable = await withTestOrg({ stripeConnectOnboardingComplete: true, stripeConnectAccountId: 'acct_test123' });
    cleanups.push(async () => {
      await purgeOrg(payable.organizationId);
      await payable.cleanup();
    });
    const svc = await seedService(payable.organizationId);
    const prop = await seedProperty(payable.organizationId, null);
    const res = await post(
      {
        organization_id: payable.organizationId,
        appointment: appointment({
          homeowner_id: null,
          is_self_pay: true,
          cleaner_id: payable.cleaner.userId,
          property_id: prop,
          service_type_id: svc,
          payment_method_id: 'ignored',
        }),
        slots: [primary],
      },
      payable.admin.accessToken,
    );
    expect(res.status).toBe(201);
    const { data: row } = await db
      .from('appointments')
      .select('homeowner_id, is_self_pay, payment_method_id, cleaner_id')
      .eq('id', res.body.data!.id)
      .single();
    expect(row).toEqual({ homeowner_id: null, is_self_pay: true, payment_method_id: null, cleaner_id: payable.cleaner.userId });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- src/app/api/appointments/route.integration.test.ts`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/appointments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { parseOperatorBookingBody } from '@/lib/appointments/parseOperatorBooking';
import { selfPayCleanerBlockReason, type CleanerPayoutFields } from '@/lib/payments/isCleanerPayable';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';

export const runtime = 'nodejs';

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * POST /api/appointments
 *
 * Creates an operator one-off booking (the recurring path is
 * /api/recurring-appointments). Owner or admin, or a manager with
 * can_edit_bookings. Body: { organization_id, appointment, slots } where
 * `appointment` is buildBookingInsert's output (extra fields ignored) and
 * `slots` is the primary time plus up to two alternates.
 *
 * Every referenced row must belong to the org: the property (and it must be
 * the selected customer's, or org-owned when there is no customer), the
 * customer (a homeowner member), the service, the checklist (on that service),
 * and the cleaner. A company-paid job is refused for a cleaner settlement could
 * not pay, with the same reason text the booking form shows.
 *
 * The row is inserted as pending / awaiting with a server-computed response
 * deadline. Offered slots are recorded only when more than one was given.
 * Returns 201 { success: true, data: { id } }.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = parseOperatorBookingBody(await request.json().catch(() => null));
    if (!parsed.ok) return fail(400, parsed.error);
    const { organization_id: orgId, appointment: a, slots } = parsed.value;

    const auth = await requireManagerPermission(request, orgId, supabaseAdmin, 'can_edit_bookings', {
      errorMessage: 'Requires the Edit Bookings permission',
    });
    if (!auth.ok) return auth.response;

    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('id, owner_id, organization_id')
      .eq('id', a.property_id)
      .maybeSingle();
    if (!property) return fail(404, 'Property not found');
    if (property.organization_id !== orgId) return fail(403, 'Property is in a different organization');
    if ((property.owner_id ?? null) !== a.homeowner_id) {
      return fail(400, 'Property does not belong to the selected customer');
    }

    if (a.homeowner_id) {
      const { data: member } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', a.homeowner_id)
        .eq('organization_id', orgId)
        .eq('role', 'homeowner')
        .maybeSingle();
      if (!member) return fail(400, 'Customer is not a homeowner in this organization');
    }

    const { data: service } = await supabaseAdmin
      .from('service_types')
      .select('id, organization_id')
      .eq('id', a.service_type_id)
      .maybeSingle();
    if (!service) return fail(404, 'Service type not found');
    if (service.organization_id !== orgId) return fail(403, 'Service type is in a different organization');

    if (a.checklist_id) {
      const { data: checklist } = await supabaseAdmin
        .from('checklists')
        .select('id, service_type_id')
        .eq('id', a.checklist_id)
        .maybeSingle();
      if (!checklist || checklist.service_type_id !== a.service_type_id) {
        return fail(400, 'Checklist does not match the selected service type');
      }
    }

    if (a.cleaner_id) {
      const { data: cleaner } = await supabaseAdmin
        .from('cleaner_profiles')
        .select(
          'id, organization_id, payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent, flat_rate_cents, payout_configured_at',
        )
        .eq('id', a.cleaner_id)
        .maybeSingle();
      if (!cleaner) return fail(404, 'Cleaner not found');
      if (cleaner.organization_id !== orgId) return fail(403, 'Cleaner is in a different organization');
      if (a.is_self_pay) {
        const reason = selfPayCleanerBlockReason(cleaner as CleanerPayoutFields);
        if (reason) return fail(400, `Cleaner cannot be offered a company-paid job: ${reason}`);
      }
    }

    const { data: created, error: insertError } = await supabaseAdmin
      .from('appointments')
      .insert({
        organization_id: orgId,
        homeowner_id: a.homeowner_id,
        cleaner_id: a.cleaner_id,
        property_id: a.property_id,
        service_type_id: a.service_type_id,
        checklist_id: a.checklist_id,
        scheduled_date: a.scheduled_date,
        scheduled_time: a.scheduled_time,
        duration_minutes: a.duration_minutes,
        total_price: a.total_price,
        price_override_enabled: a.price_override_enabled,
        price_override_total: a.price_override_total,
        special_requests: a.special_requests,
        payment_method_id: a.payment_method_id,
        is_self_pay: a.is_self_pay,
        status: 'pending',
        cleaner_confirmation_status: 'awaiting',
        response_deadline: computeResponseDeadlineISO(a.scheduled_date, a.scheduled_time),
      })
      .select('id')
      .single();
    if (insertError || !created) {
      return fail(500, insertError?.message ?? 'Could not create the booking');
    }

    if (slots.length > 1) {
      const { error: slotsError } = await supabaseAdmin
        .from('appointment_requested_slots')
        .insert(slots.map((s) => ({ appointment_id: created.id, ...s })));
      if (slotsError) console.error('appointment_requested_slots insert failed:', slotsError.message);
    }

    return NextResponse.json({ success: true, data: { id: created.id as string } }, { status: 201 });
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : 'Internal server error');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- src/app/api/appointments/route.integration.test.ts`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/appointments/route.ts src/app/api/appointments/route.integration.test.ts
git commit -m "feat(bookings): POST /api/appointments creates operator one-off bookings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 14: `bookings-api.ts` and the `useCreateOperatorBooking` rewire

**Files:**
- Create: `src/components/redesign/bookings/new-booking/bookings-api.ts`
- Modify: `src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts`

**Interfaces:**
- Consumes: `apiFetch` (Task 1); `BookingInsert` from `./buildBookingInsert` (exists); the route from Task 13.
- Produces: `createBookingApi(body: CreateBookingBody): Promise<ApiResult<{ id: string }>>`. The hook's exported shape `{ create, creating }` and `CreateBookingResult` are unchanged.

- [ ] **Step 1: Write the API module**

```ts
// src/components/redesign/bookings/new-booking/bookings-api.ts
import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { BookingInsert } from './buildBookingInsert';

export interface CreateBookingBody {
  organization_id: string;
  appointment: BookingInsert['appointment'];
  slots: BookingInsert['slots'];
}

export const createBookingApi = (body: CreateBookingBody): Promise<ApiResult<{ id: string }>> =>
  apiFetch<{ id: string }>('/api/appointments', { method: 'POST', body });
```

- [ ] **Step 2: Rewire the one-off branch**

In `useCreateOperatorBooking.ts`:

1. Delete `import { supabase } from '@/lib/supabase';` and add `import { createBookingApi } from './bookings-api';`.
2. Replace the JSDoc above `useCreateOperatorBooking` with:

```ts
/**
 * Create an operator booking. A one-time booking POSTs to /api/appointments (the route resolves and
 * checks every referenced row and inserts the appointment plus offered slots). A recurring booking
 * (customer-billed only) POSTs to /api/recurring-appointments. Both send a Bearer token and the route
 * enforces org membership + role. On success invalidates the org appointments so the booking(s)
 * appear in the list.
 */
```

3. Replace everything from `const { data, error } = await supabase` through `return { recurring: false, count: 1 };` with:

```ts
      const res = await createBookingApi({ organization_id: currentOrganizationId, appointment, slots });
      if (!res.success) throw new Error(res.error);
      return { recurring: false, count: 1 };
```

The lines above it (`const primary`, `const deadline`, `const { appointment, slots } = buildBookingInsert(...)`) stay: `buildBookingInsert` still receives the client-computed deadline for its own unit test's sake, and the route recomputes it.

- [ ] **Step 3: Check types and lint, then smoke it**

Run: `npx tsc --noEmit 2>&1 | grep -E "new-booking|api/appointments/route"`
Expected: no lines.

Run: `npm run lint`
Expected: no errors in the touched files.

Smoke: in the operator app, open New booking and create (a) a customer-billed one-off with two alternate times, (b) a company-paid job on an org-owned property with a payable cleaner. Both appear in Bookings; the confirm dialog's existing copy is unchanged. With an unpayable cleaner the picker still greys the row (client), and if forced through the Network tab the route answers 400 with the same reason.

- [ ] **Step 4: Commit**

```bash
git add src/components/redesign/bookings/new-booking/bookings-api.ts src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts
git commit -m "feat(bookings): one-off operator bookings go through POST /api/appointments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 15: property body parser

**Files:**
- Create: `src/lib/properties/parsePropertyInput.ts`
- Test: `src/lib/properties/parsePropertyInput.test.ts`

**Interfaces:**
- Consumes: `asRecord`, `isUuid`, `parseOptionalText`, `parseRequiredText`, `ParseResult` (Task 2).
- Produces: `parsePropertyCreate(body: unknown): ParseResult<PropertyCreateInput>` with `PropertyCreateInput = { organization_id, owner_id: string | null, name, address, city, state, zip_code, bedrooms: number | null, bathrooms: number | null, square_feet: number | null, special_instructions: string | null, access_instructions: string | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/properties/parsePropertyInput.test.ts
import { describe, it, expect } from 'vitest';
import { parsePropertyCreate } from './parsePropertyInput';

const ORG = '5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
const OWNER = '11111111-1111-4111-8111-111111111111';
const valid = {
  organization_id: ORG,
  name: ' Lake House ',
  address: '1 Shore Rd',
  city: 'Austin',
  state: 'TX',
  zip_code: '78701',
  bedrooms: '3',
  bathrooms: 2.5,
  square_feet: null,
  special_instructions: '  ',
  access_instructions: ' Key under mat ',
};

describe('parsePropertyCreate', () => {
  it('normalizes a valid body; owner_id defaults to null', () => {
    expect(parsePropertyCreate(valid)).toEqual({
      ok: true,
      value: {
        organization_id: ORG,
        owner_id: null,
        name: 'Lake House',
        address: '1 Shore Rd',
        city: 'Austin',
        state: 'TX',
        zip_code: '78701',
        bedrooms: 3,
        bathrooms: 2.5,
        square_feet: null,
        special_instructions: null,
        access_instructions: 'Key under mat',
      },
    });
  });

  it('keeps an explicit owner_id', () => {
    expect(parsePropertyCreate({ ...valid, owner_id: OWNER })).toMatchObject({ ok: true, value: { owner_id: OWNER } });
  });

  it.each([
    [{ organization_id: 'x' }, 'organization_id is required'],
    [{ owner_id: 'x' }, 'owner_id must be an id'],
    [{ name: '' }, 'Property name is required'],
    [{ address: '  ' }, 'Address is required'],
    [{ city: undefined }, 'City is required'],
    [{ state: '' }, 'State is required'],
    [{ zip_code: '' }, 'ZIP code is required'],
    [{ bedrooms: 1.5 }, 'Bedrooms must be a whole number of 0 or more'],
    [{ bedrooms: -1 }, 'Bedrooms must be a whole number of 0 or more'],
    [{ bathrooms: 'two' }, 'Bathrooms must be a number of 0 or more'],
    [{ square_feet: 12.5 }, 'Square feet must be a whole number of 0 or more'],
    [{ special_instructions: 4 }, 'Special instructions must be text'],
  ] as const)('rejects %j', (override, error) => {
    expect(parsePropertyCreate({ ...valid, ...override })).toEqual({ ok: false, error });
  });

  it('treats empty strings for the numbers as null', () => {
    expect(parsePropertyCreate({ ...valid, bedrooms: '', bathrooms: '', square_feet: '' })).toMatchObject({
      ok: true,
      value: { bedrooms: null, bathrooms: null, square_feet: null },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- src/lib/properties/parsePropertyInput.test.ts`
Expected: FAIL, cannot resolve `./parsePropertyInput`.

- [ ] **Step 3: Write the parser**

```ts
// src/lib/properties/parsePropertyInput.ts
import { asRecord, isUuid, parseOptionalText, parseRequiredText, type ParseResult } from '@/lib/catalog/parse';

export interface PropertyCreateInput {
  organization_id: string;
  owner_id: string | null;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  special_instructions: string | null;
  access_instructions: string | null;
}

/** Absent, null, or '' become null; otherwise a finite number of 0 or more (whole when `integer`). */
function parseOptionalNumber(v: unknown, label: string, integer: boolean): ParseResult<number | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  const whole = integer ? 'a whole number' : 'a number';
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
    return { ok: false, error: `${label} must be ${whole} of 0 or more` };
  }
  return { ok: true, value: n };
}

export function parsePropertyCreate(body: unknown): ParseResult<PropertyCreateInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  if (!isUuid(r.organization_id)) return { ok: false, error: 'organization_id is required' };

  let ownerId: string | null = null;
  if (r.owner_id !== undefined && r.owner_id !== null) {
    if (!isUuid(r.owner_id)) return { ok: false, error: 'owner_id must be an id' };
    ownerId = r.owner_id;
  }

  const name = parseRequiredText(r.name, 'Property name', 200);
  if (!name.ok) return name;
  const address = parseRequiredText(r.address, 'Address', 300);
  if (!address.ok) return address;
  const city = parseRequiredText(r.city, 'City', 120);
  if (!city.ok) return city;
  const state = parseRequiredText(r.state, 'State', 50);
  if (!state.ok) return state;
  const zip = parseRequiredText(r.zip_code, 'ZIP code', 20);
  if (!zip.ok) return zip;

  const bedrooms = parseOptionalNumber(r.bedrooms, 'Bedrooms', true);
  if (!bedrooms.ok) return bedrooms;
  const bathrooms = parseOptionalNumber(r.bathrooms, 'Bathrooms', false);
  if (!bathrooms.ok) return bathrooms;
  const squareFeet = parseOptionalNumber(r.square_feet, 'Square feet', true);
  if (!squareFeet.ok) return squareFeet;

  const special = parseOptionalText(r.special_instructions, 'Special instructions');
  if (!special.ok) return special;
  const access = parseOptionalText(r.access_instructions, 'Access instructions');
  if (!access.ok) return access;

  return {
    ok: true,
    value: {
      organization_id: r.organization_id,
      owner_id: ownerId,
      name: name.value,
      address: address.value,
      city: city.value,
      state: state.value,
      zip_code: zip.value,
      bedrooms: bedrooms.value,
      bathrooms: bathrooms.value,
      square_feet: squareFeet.value,
      special_instructions: special.value,
      access_instructions: access.value,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- src/lib/properties/parsePropertyInput.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/properties/parsePropertyInput.ts src/lib/properties/parsePropertyInput.test.ts
git commit -m "feat(properties): pure body parser for POST /api/properties

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 16: `POST /api/properties`

**Files:**
- Create: `src/app/api/properties/route.ts`
- Test: `src/app/api/properties/route.integration.test.ts`

**Interfaces:**
- Consumes: `parsePropertyCreate` (Task 15); `requireManagerPermission` with `'can_edit_properties'` and `allowedRoles: ['homeowner', 'owner', 'admin', 'manager']`.
- Produces: `POST /api/properties` → `201 { success: true, data: Property }`.

Rules: a homeowner caller always becomes the owner (any `owner_id` in the body is ignored). An owner, admin, or flagged manager must send `owner_id`, and it must be a homeowner member of the org. Migration 104's RLS already encodes these two shapes; the route mirrors them because it writes with the service role.

- [ ] **Step 1: Write the failing integration test**

```ts
// src/app/api/properties/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../tests/helpers/auth';
import { withTestOrg, addManagerToOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

type Body = { success?: boolean; data?: Record<string, unknown>; error?: string };

const db = createTestSupabaseClient();

describe('POST /api/properties', () => {
  let org: TestOrgFixture;
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    org = await withTestOrg();
  });
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    await db.from('properties').delete().eq('organization_id', org.organizationId);
    await org.cleanup();
  });

  const fields = (over: Record<string, unknown> = {}) => ({
    organization_id: org.organizationId,
    name: 'Lake House',
    address: '1 Shore Rd',
    city: 'Austin',
    state: 'TX',
    zip_code: '78701',
    bedrooms: 3,
    bathrooms: 2,
    square_feet: 1800,
    special_instructions: null,
    access_instructions: 'Key under mat',
    ...over,
  });
  const post = (b: unknown, token?: string) =>
    callRoute<Body>(POST, { method: 'POST', url: 'http://test/api/properties', headers: token ? bearerHeader(token) : {}, body: b });

  it('returns 401 without a token and 400 on an invalid body', async () => {
    expect((await post(fields())).status).toBe(401);
    const res = await post(fields({ address: '' }), org.homeowner.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Address is required');
  });

  it('a homeowner adds their own home; any owner_id in the body is ignored', async () => {
    const res = await post(fields({ owner_id: org.admin.userId }), org.homeowner.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organization_id: org.organizationId,
      owner_id: org.homeowner.userId,
      name: 'Lake House',
      bedrooms: 3,
      access_instructions: 'Key under mat',
    });
  });

  it('an admin adds a home for a homeowner member', async () => {
    const res = await post(fields({ owner_id: org.homeowner.userId }), org.admin.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ owner_id: org.homeowner.userId });
  });

  it('an admin must name a homeowner of this org', async () => {
    const missing = await post(fields(), org.admin.accessToken);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('owner_id is required');
    const wrongRole = await post(fields({ owner_id: org.cleaner.userId }), org.admin.accessToken);
    expect(wrongRole.status).toBe(400);
    expect(wrongRole.body.error).toBe('owner_id must be a homeowner in this organization');
  });

  it('returns 403 for a cleaner, a manager without can_edit_properties, and members of another org', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: false });
    cleanups.push(() => mgr.cleanup());
    const other = await withTestOrg();
    cleanups.push(() => other.cleanup());
    expect((await post(fields({ owner_id: org.homeowner.userId }), org.cleaner.accessToken)).status).toBe(403);
    expect((await post(fields({ owner_id: org.homeowner.userId }), mgr.accessToken)).status).toBe(403);
    expect((await post(fields({ owner_id: org.homeowner.userId }), other.admin.accessToken)).status).toBe(403);
    expect((await post(fields(), other.homeowner.accessToken)).status).toBe(403);
  });

  it('a manager with can_edit_properties adds a home for a homeowner member', async () => {
    const mgr = await addManagerToOrg(org.organizationId, { can_edit_properties: true });
    cleanups.push(() => mgr.cleanup());
    expect((await post(fields({ owner_id: org.homeowner.userId }), mgr.accessToken)).status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- src/app/api/properties/route.integration.test.ts`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/properties/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { parsePropertyCreate } from '@/lib/properties/parsePropertyInput';

export const runtime = 'nodejs';

/**
 * POST /api/properties
 *
 * Adds a home. A homeowner adds their own (owner forced to the caller). An
 * owner, admin, or manager with can_edit_properties adds one for a homeowner
 * member of the org (owner_id required and checked). These are the two shapes
 * migration 104's properties_insert policy allows for those roles; the route
 * mirrors them because it writes with the service role.
 *
 * Body: { organization_id, owner_id?, name, address, city, state, zip_code,
 *         bedrooms?, bathrooms?, square_feet?, special_instructions?, access_instructions? }
 * Returns 201 { success: true, data: Property }.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = parsePropertyCreate(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const auth = await requireManagerPermission(request, input.organization_id, supabaseAdmin, 'can_edit_properties', {
      allowedRoles: ['homeowner', 'owner', 'admin', 'manager'],
      errorMessage: 'Requires the Edit properties permission',
    });
    if (!auth.ok) return auth.response;

    let ownerId: string;
    if (auth.role === 'homeowner') {
      ownerId = auth.userId;
    } else {
      if (!input.owner_id) return NextResponse.json({ error: 'owner_id is required' }, { status: 400 });
      const { data: member } = await supabaseAdmin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', input.owner_id)
        .eq('organization_id', input.organization_id)
        .eq('role', 'homeowner')
        .maybeSingle();
      if (!member) {
        return NextResponse.json({ error: 'owner_id must be a homeowner in this organization' }, { status: 400 });
      }
      ownerId = input.owner_id;
    }

    const { data, error } = await supabaseAdmin
      .from('properties')
      .insert({
        organization_id: input.organization_id,
        owner_id: ownerId,
        name: input.name,
        address: input.address,
        city: input.city,
        state: input.state,
        zip_code: input.zip_code,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        square_feet: input.square_feet,
        special_instructions: input.special_instructions,
        access_instructions: input.access_instructions,
      })
      .select('*')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Could not save the property.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- src/app/api/properties/route.integration.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/properties/route.ts src/app/api/properties/route.integration.test.ts
git commit -m "feat(properties): POST /api/properties adds a home behind org auth

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
```

### Task 17: `properties-api.ts` and the `PropertyFormSheet` rewire

**Files:**
- Create: `src/components/redesign/homeowner/account/properties/properties-api.ts`
- Modify: `src/components/redesign/homeowner/account/properties/PropertyFormSheet.tsx` (the insert branch of the submit handler, and the imports)

**Interfaces:**
- Consumes: `apiFetch` (Task 1); `Property` from `@/hooks/useHomeownerData` (exists); the route from Task 16.
- Produces: `createPropertyApi(body): Promise<ApiResult<Property>>`.

- [ ] **Step 1: Write the API module**

```ts
// src/components/redesign/homeowner/account/properties/properties-api.ts
import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { Property } from '@/hooks/useHomeownerData';

export interface CreatePropertyBody {
  organization_id: string;
  /** Operators name the homeowner; a homeowner caller is always the owner and may omit this. */
  owner_id?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  special_instructions: string | null;
  access_instructions: string | null;
}

export const createPropertyApi = (body: CreatePropertyBody): Promise<ApiResult<Property>> =>
  apiFetch<Property>('/api/properties', { method: 'POST', body });
```

- [ ] **Step 2: Rewire the insert branch**

In `PropertyFormSheet.tsx`:

1. Delete `import { supabase } from '@/lib/supabase';` (its only use was the insert) and add `import { createPropertyApi } from './properties-api';`.
2. Replace the `else` branch of the submit handler:

```ts
      } else {
        const res = await createPropertyApi({ ...payload, organization_id: currentOrganizationId });
        if (!res.success) throw new Error(res.error);
      }
```

The edit branch (`updateProperty`, a lifecycle write) and everything after (`invalidateQueries`, toast, `onSaved`) stay exactly as they are.

- [ ] **Step 3: Run the gates**

Run: `npx tsc --noEmit 2>&1 | grep -E "PropertyFormSheet|properties-api|api/properties|parsePropertyInput|new-booking|api/appointments/route|parseOperatorBooking|isCleanerPayable"`
Expected: no lines.

Run: `npm run lint`
Expected: no errors in the touched files.

Run: `npm run test:unit -- src/lib src/components/redesign/bookings/new-booking`
Expected: pass.

Run: `npm run test:integration -- src/app/api/appointments/route.integration.test.ts src/app/api/properties/route.integration.test.ts`
Expected: pass.

- [ ] **Step 4: Smoke it in the browser**

Sign in as a homeowner, open Account then Properties, add a home with a photo. It appears in the list and the "Property added" toast shows. Edit it (still direct) and confirm the edit saves.

- [ ] **Step 5: Commit, push, open PR C**

```bash
git add src/components/redesign/homeowner/account/properties/properties-api.ts src/components/redesign/homeowner/account/properties/PropertyFormSheet.tsx
git commit -m "feat(properties): homeowner add-home goes through POST /api/properties

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd"
git push -u origin feat/phase1a-booking-property-routes
gh pr create --base feat/phase1a-checklist-routes --title "feat(bookings, properties): one-off bookings and add-home go through API routes (Phase 1a, PR C)" --body "$(cat <<'EOF'
## Summary
- `POST /api/appointments`: operator one-off booking. Validates property, customer, service, checklist and cleaner against the org, applies the company-pays cleaner gate server-side, forces pending/awaiting and a server-side response deadline, records offered slots.
- `POST /api/properties`: add a home. Homeowner is always the owner; operators name a homeowner member.
- `useCreateOperatorBooking` and `PropertyFormSheet` call the routes. `selfPayCleanerBlockReason` moved to `src/lib/payments/isCleanerPayable.ts` (re-exported from its old home).
- Stacks on PR B. Spec §12.3, §12.4. Plan Tasks 12 to 17.

## Test plan
- [x] unit: `parseOperatorBooking`, `parsePropertyInput`, existing `deriveOperatorBooking` test still green
- [x] integration: both route files
- [x] manual: customer-billed and company-paid bookings; homeowner add-home

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01J23Vyn9Gx9QoBWdEK1DTQd
EOF
)"
```

---

### Task 18: stack, review, merge, clean up

**Files:** none (git and GitHub only).

- [ ] **Step 1: Link the three PRs into a stack**

```bash
gh stack init feat/phase1a-services-routes feat/phase1a-checklist-routes feat/phase1a-booking-property-routes
gh stack submit
```

- [ ] **Step 2: Fable reviews each PR**

The reviewer checks, per PR: every guarded write in §4's table now goes through a route; no `supabase.from(...).insert|update|delete` remains in `useServices.ts`, `useChecklists.ts`, `useCreateOperatorBooking.ts`, or `PropertyFormSheet.tsx` except the reads named in the plan; every route authorizes against the resolved org; every route has its integration test; no em dashes in new strings; no `supabase-admin` import from client code. Run this grep on the stack's top branch and expect no output:

```bash
grep -n -E "\.from\('(service_types|checklists|checklist_line_items|appointments|appointment_requested_slots|properties)'\)\s*$|\.insert\(|\.update\(|\.delete\(" src/hooks/useServices.ts src/hooks/useChecklists.ts src/components/redesign/bookings/new-booking/useCreateOperatorBooking.ts src/components/redesign/homeowner/account/properties/PropertyFormSheet.tsx
```

- [ ] **Step 3: Merge bottom-up**

For each layer, all four checks must be green (`CI / typecheck + lint`, `CI / unit + integration`, both `E2E / Playwright (preview)` jobs). If `Migrate / migrate-dev` is red with "Remote migration versions not found", that is shared-dev drift from another branch; these PRs carry no migrations, so it can be waved off for them.

```bash
gh stack merge --yes --squash <PR A number>
# wait ~15 minutes for PR B's auto-rebased checks
gh stack merge --yes --squash <PR B number>
# wait again
gh stack merge --yes --squash <PR C number>
```

- [ ] **Step 4: Clean up and fast-forward staging**

```bash
git fetch origin --prune
git branch -D feat/phase1a-services-routes feat/phase1a-checklist-routes feat/phase1a-booking-property-routes
git push origin origin/master:dev   # fast-forward only; skip if it is refused
```

- [ ] **Step 5: Record completion**

Tick PRs A, B, C in the spec's §20 table (add "merged <date>, #<pr>" to each row) and note in `docs/MASTER-TODO.md` that Phase 1a is done and the billing core plan (PR D and E) is next.

## Self-review

**Spec coverage (§4 table, §12):**
- `service_types` insert / update / delete / duplicate-with-checklists → Tasks 3, 4, 5. ✔
- `checklists` + `checklist_line_items` CRUD, bulk add, reorder, duplicate → Tasks 7 to 11 (duplicate checklist = read + `POST .../checklists` with items). ✔
- operator one-off booking → Tasks 12 to 14. ✔
- homeowner add-home → Tasks 15 to 17. ✔
- §12 conventions: resolved org, `supabaseAdmin`, JSON envelope, `runtime = 'nodejs'`, co-located integration tests, `getAccessToken()` fetch pattern, hooks keep cache logic. ✔
- §19 "every Phase 1a route: 401/403/org-scope/happy path" ✔; "402 when frozen with the flag on; pass-through with the flag off" belongs to the billing core plan (PR D), where the guard is added to these routes.
- §22 item 1 (manager permission key): resolved in Global Constraints. ✔
- Deviation from §12.2 (line-item route path): recorded in Decisions and amended in the spec.

**Placeholder scan:** no TBD/TODO; every code step carries its code; no "similar to Task N".

**Type consistency:** `ApiResult<T>` (Task 1) used by every `*-api.ts`; `ParseResult<T>`, `asRecord`, `isUuid`, `parseMoney`, `parseRequiredText`, `parseOptionalText` (Task 2) used by Tasks 6, 12, 15; `ChecklistSeed` (Task 2) used by Tasks 3 and 5; `authorizeService` (Task 4) used by Task 7; `authorizeChecklist` / `authorizeLineItem` (Task 7) used by Tasks 8, 9, 10; `BookingInsert` (existing) used by Task 14; `Property` from `useHomeownerData` used by Task 17. Route params: `{ id }` everywhere except `checklist-items/[itemId]` which uses `{ itemId }`, and its test passes `{ itemId }`. ✔
