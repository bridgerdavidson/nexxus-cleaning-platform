---
name: create-tests
description: Operational playbook for writing tests in the Nexxus Cleaning Platform's Vitest 3 + Playwright test suite. Use this skill whenever a new API route, helper function, business-logic module, or user-facing feature is added or modified - tests should follow code. Triggers on phrases like "add tests for", "write a test", "test this route", "cover this with tests", "we need tests", "let's add tests for the new feature", "test the new endpoint", "I just added X (now add tests)", "test the auth on this route". Includes the decision tree for unit vs integration vs E2E, the exact directory and naming conventions, the helpers in tests/helpers/, schema gotchas the local Supabase has, auth/org-scope assertion patterns, and Stripe webhook testing. Use even when the user just says "I just implemented X" without explicitly asking for tests - in this codebase tests are part of the work. Skip only if the user explicitly says "no tests" or the change is purely documentation, comments, or non-functional.
---

# Create Tests

Operational playbook for adding a test that matches this codebase's conventions. CLAUDE.md "Running tests" describes the suite at a high level; this skill is what to read when actually writing one.

## Decision tree — which kind of test?

Pick the matching category for what you just built:

- **Unit test** (`*.test.ts` co-located with source under `src/lib/**`) — pure logic that doesn't touch the database, HTTP, Stripe, or Supabase. Fast (<1 ms each), no infra required. Examples: `src/lib/appointments/recurrence.test.ts`, `src/lib/auth/requireOrgAuth.test.ts`.

- **Integration test** (`*.integration.test.ts` co-located next to a route under `src/app/api/**`) — any API route handler. Calls the handler directly via `callRoute(POST, { ... })` (no HTTP server) against a **real local Supabase**. Use whenever you add a new route or change auth/org-scope behavior. Requires `npx supabase start` running.

- **E2E test** (`tests/e2e/<name>.spec.ts`) — full browser flow across pages. Use sparingly — only when a feature genuinely needs UI verification (login → dashboard → action). Most new features don't need an E2E.

Defaults:
- **"I added a new route"** → integration test
- **"I added a util / business-logic function"** → unit test
- **"I added a new page-level user flow"** → unit + integration for the API behind it, optional E2E

If the new code mixes pure logic + a route, write **both** — unit-test the logic in isolation, integration-test the route.

## Where the file goes

| Test type | File path | Naming |
|---|---|---|
| Unit | next to source | `recurrence.test.ts` next to `recurrence.ts` |
| Integration | next to route | `route.integration.test.ts` next to `route.ts` |
| E2E | `tests/e2e/` | `feature-name.spec.ts` |

**Match the naming exactly**. Vitest's `projects` config in `vitest.config.mts` splits unit vs integration by filename suffix. A unit test misnamed as `.integration.test.ts` will land on the integration runner and try to connect to a Supabase that isn't there.

## Helpers — use these, don't roll your own

All under `tests/helpers/`.

### `tests/helpers/auth.ts`

- **`bearerHeader(token: string)`** → `{ Authorization: 'Bearer <token>' }`. Pass to `callRoute`'s `headers`.
- **`callRoute<T>(handler, { method, headers?, body?, url? })`** → `{ status, body, raw }`. Invokes a Next.js App Router handler directly via `NextRequest`. No HTTP server, no port, no flake.

### `tests/helpers/supabase.ts`

- **`createTestSupabaseClient()`** — service-role client for setup/teardown/assertions. Use in `beforeEach` to seed data and in `it` blocks to read back what the route wrote.
- **`createAnonClient()`** — anon client. Rare — only when specifically testing client-side RLS behavior.

### `tests/helpers/fixtures.ts`

- **`withTestOrg(opts?)`** → `{ organizationId, admin, cleaner, homeowner, cleanup() }`. Creates an isolated tenant: a fresh organization plus three users with `app_metadata.role` set, `user_profiles` rows, `organization_members` rows, and a `cleaner_profiles` row for the cleaner. Each user has a real `accessToken` (signed in via password grant). Override cleaner setup via `{ payoutPercent, stripeConnectOnboardingComplete, stripeConnectAccountId }`. Call `cleanup()` in `afterEach`.

- **`createTestAppointment({ organizationId, cleanerId, homeownerId, totalPrice?, status?, scheduledDate?, scheduledTime? })`** → `{ id }`. Inserts a property + service_type + appointment with sensible defaults.

- **`buildPaymentIntentSucceededEvent({ appointmentId, amountDollars, eventId? })`** → object shaped like a real Stripe `event` payload. JSON-stringify and sign it for webhook tests.

### `tests/helpers/stripe.ts`

- **`signWebhookPayload(payload: string, secret?: string)`** — returns a valid `stripe-signature` header value so the route's real `constructWebhookEvent` accepts the payload.
- **`StripeFake` type** — describes `globalThis.__stripeFake`. Read `transferCalls` and `paymentIntentCalls` in webhook tests to assert exact-once semantics.

### `tests/helpers/db.ts`

- **`resetDb()`** — truncates volatile tables in FK order. Mostly handled per-test via `withTestOrg().cleanup()`. Avoid calling directly unless you have a specific need.

## Integration test template

Copy this skeleton when adding tests for a new route. Replace `POST` with the route's exported method.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/your-route', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;  // only if testing cross-org rejection

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { /* minimal valid-shaped body */ },
    });
    expect(status).toBe(401);
  });

  it('rejects non-admin caller (cleaner role)', async () => {
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organization_id: org.organizationId /* ... */ },
    });
    expect(status).toBe(403);
  });

  it('rejects cross-org caller (org2 acting on org1 resource)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { appointment_id: appt.id, organization_id: org2.organizationId },
    });
    // 404 preferred (don't leak existence). 403 acceptable too.
    expect([403, 404]).toContain(status);
  });

  it('succeeds for an authorized admin and writes the expected DB state', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { organization_id: org.organizationId /* ... */ },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Read back to verify side effects
    const admin = createTestSupabaseClient();
    const { data } = await admin.from('some_table').select('*').eq('organization_id', org.organizationId);
    expect(data).toHaveLength(1);
  });
});
```

**Always include at minimum**: a 401 (no auth), a 403 (wrong role), and a happy-path 200 with a DB read-back. Add a cross-org test whenever the route touches `organization_id`. Add specific bug-reproduction tests when fixing a bug — the test that proves the bug existed.

## Unit test template

```typescript
import { describe, it, expect } from 'vitest';
import { myPureFunction } from './my-pure-function';

describe('myPureFunction', () => {
  it('handles the typical case', () => {
    expect(myPureFunction(1, 2)).toBe(3);
  });

  it('handles the edge case at 0', () => {
    expect(myPureFunction(0, 0)).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(() => myPureFunction(NaN, 1)).toThrow(/invalid/i);
  });
});
```

For unit tests that need to mock dependencies (like `requireOrgAuth.test.ts` does for Supabase), construct lightweight inline fakes with `vi.fn()` chained via `mockReturnValue` — clearer and self-contained than reaching for module-level `vi.mock`.

## Common patterns

### Auth-first ordering — test that 401 wins over 400

All four hardened routes (`delete-team-member`, `appointments/confirm`, `stripe/create-payment-intent`, `payments/record`) call `requireOrgAuth` **before** validating the body. Mirror that order in tests:

```typescript
it('returns 401 before validating body', async () => {
  const { status } = await callRoute(POST, {
    method: 'POST',
    body: { /* deliberately invalid — missing required fields */ },
  });
  expect(status).toBe(401);  // not 400
});
```

If you get 400 here, the **route** is validating before checking auth — fix the route, not the test.

### Don't leak resource existence cross-org

When org2 references an org1 resource by ID, return **404** (not 403, not 200). 404 doesn't tell org2 whether the resource exists at all.

```typescript
expect(status).toBe(404);
```

### Verify bearer-verified identity, not body identity

Never trust caller identity from the request body. The verified `userId` comes from `supabaseAdmin.auth.getUser(token)` via `requireOrgAuth`. Tests should pass a wrong-on-purpose body field and assert the route ignored it:

```typescript
const { status } = await callRoute(POST, {
  method: 'POST',
  headers: bearerHeader(org.cleaner.accessToken),  // bearer is the cleaner
  body: { cleanerId: 'some-other-id' /* should be ignored */ },
});
expect(status).toBe(200);  // route used bearer-derived id, not body
```

### Test idempotency for webhook handlers

Webhook handlers must be safe to call multiple times. Send the same signed payload twice and assert exactly-once side effects:

```typescript
const payload = JSON.stringify(buildPaymentIntentSucceededEvent({ ... }));
const signature = signWebhookPayload(payload);
const headers = { 'content-type': 'application/json', 'stripe-signature': signature };

await callRoute(POST, { method: 'POST', headers, body: payload });
await callRoute(POST, { method: 'POST', headers, body: payload });

const state = (globalThis as { __stripeFake: import('../../../../../tests/helpers/stripe').StripeFake }).__stripeFake;
expect(state.transferCalls.length).toBe(1);  // second call short-circuited

const admin = createTestSupabaseClient();
const { data } = await admin.from('payouts').select('id').eq('appointment_id', appt.id);
expect(data).toHaveLength(1);
```

## Schema gotchas (local Supabase is missing some prod triggers)

Local Supabase is rebuilt from `supabase/migrations/000_baseline.sql` + later migrations. The baseline dump only includes the `public` schema, so:

- **`auth.users` triggers don't fire locally.** The prod `handle_new_user` trigger that auto-inserts a `user_profiles` row on `auth.users` insert doesn't run. `withTestOrg` handles this by explicitly upserting `user_profiles`. If you write your own fixture, do the same — or you'll hit FK violations from `organization_members.user_id` → `user_profiles.id`.

- **`cleaner_profiles.organization_id` is NOT NULL.** Always set it when inserting (`withTestOrg` does this for you).

- **`properties.name` is NOT NULL.** Always set it (`createTestAppointment` does this).

- **`payments.appointment_id` is required** for routes that insert payments. Most paths need it.

- **`payments` table has no `homeowner_id` column.** Don't insert one or you'll get a "column does not exist" error.

- **`payment_method` enum is `'card' | 'ach' | 'manual'`.** Not `'cash'`. Use `'manual'` for non-electronic payments.

- **Column-name traps** (documented in `src/types/index.ts` bottom):
  - `appointments`/`service_types` use `duration_minutes`, NOT `estimated_duration`
  - `appointments` uses `special_requests`, NOT `special_instructions` (that's on `properties`)
  - `cleaner_profiles.id` IS the user's `auth.users.id` — no separate `user_id` column
  - `cleaner_id` columns elsewhere point at `cleaner_profiles.id` (which equals the user id)

If a test fails with PostgREST error `column ... does not exist`, the schema dump probably missed a Studio-added column. Fix path: write an idempotent migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`) in `supabase/migrations/`, then locally `npx supabase db reset` to confirm.

## Stripe-specific patterns

### The Stripe SDK is mocked in integration tests

`tests/setup/integration.setup.ts` calls `vi.mock('@/lib/stripe', ...)` at module top-level (required — `vi.mock` is statically hoisted and can't safely close over function-scoped state). The mock stubs `getStripe()` (throws if called) and replaces `createConnectTransfer`, `createPaymentIntent`, `getDefaultPaymentMethod`, `getPayoutTransferIds` with `vi.fn()`s that record their args on `globalThis.__stripeFake`.

The fake's `createConnectTransfer` simulates Stripe's idempotency semantics: same `idempotencyKey` (`payout-${appointmentId}`) returns the existing transfer instead of creating a new one. This is what makes the idempotency test pattern above work.

### `constructWebhookEvent` stays real

The signature verification path is itself a security boundary worth testing for real. Build payloads with `signWebhookPayload(JSON.stringify(event))` so the route's real `constructWebhookEvent` verifies them with the test secret.

```typescript
const event = buildPaymentIntentSucceededEvent({
  appointmentId: appt.id,
  amountDollars: 100,
});
const payload = JSON.stringify(event);
const signature = signWebhookPayload(payload);

const { status } = await callRoute(POST, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': signature },
  body: payload,
});
expect(status).toBe(200);
```

### Test the bad-signature path explicitly

```typescript
it('returns 400 for invalid signature', async () => {
  const payload = JSON.stringify(buildPaymentIntentSucceededEvent({ ... }));
  const { status } = await callRoute(POST, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1234,v1=garbage' },
    body: payload,
  });
  expect(status).toBe(400);
});
```

## E2E test pattern (when needed)

```typescript
import { test, expect } from '@playwright/test';

test('user can do the thing', async ({ page }) => {
  await page.goto('/some-route', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="x"]').fill('value');
  await page.getByRole('button', { name: /submit/i }).click();
  await expect(page.getByText(/success/i)).toBeVisible({ timeout: 10_000 });
});
```

E2E runs against `npm run dev` locally or `PLAYWRIGHT_BASE_URL` in CI. It does **not** have access to the Vitest helpers above (different test runner, different process). Seed required data via API calls in the test setup if needed, not via direct Supabase access — closer to what a real user does.

E2E specs that depend on auth (`auth.spec.ts`) use `process.env.E2E_TEST_USER_EMAIL` / `_PASSWORD` and skip themselves when those env vars are unset. Follow that pattern — it lets E2E run against any environment without hard-coding credentials.

## After writing the test

Before pushing, run locally to confirm:

```powershell
# Unit only (no infra):
npm run test:unit

# Integration (needs Docker + supabase):
npx supabase start          # if not already running
npm run test:integration

# Everything (what CI runs):
npm run test
```

If a test fails locally, fix it before pushing. CI runs the same suite and will fail the same way.

## Don't do this

- **Don't roll your own org/user setup.** Use `withTestOrg()`. Fixing one helper benefits every future test.
- **Don't insert directly to set up state when the route under test could create it.** If you're testing `POST /api/payments/record`, don't seed a payment row — call the route. Exception: setting up *prerequisite* state (an appointment to record a payment against) is fine.
- **Don't mock `@/lib/supabase-admin`.** Integration tests use real Supabase. Mocking the admin client defeats the point of running against a real DB.
- **Don't depend on test order.** Each `beforeEach` creates a fresh tenant. Don't share state between `it()` blocks via `let` variables outside `beforeEach`.
- **Don't skip the `cleanup()` in `afterEach`.** Leaked test orgs accumulate across runs, slow integration tests down, and eventually cause auth rate limits.
- **Don't `console.log` for debugging in committed tests.** Use a focused test (`it.only`) or actual `expect` assertions instead. CI surfaces the assertion failure clearly; console output is noise.
