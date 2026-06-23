# Operator "Cleaners & team" screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, this session) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. UI leaf components are CLONES of the named `src/components/redesign/customers/*` files with the deltas listed per task; open the source file and adapt it rather than writing from scratch.

**Goal:** Replace the legacy Cleaner Management / Team Members / Invites tabs with one flag-gated operator "Cleaners & team" screen that is a crew operations workspace: roster with triage signals, per-cleaner performance scorecard + workload + payout health, invites folded in (with Cancel), and soft deactivate/bench.

**Architecture:** Clone the operator Customers `gate → OperatorCleanersData container → pure OperatorCleanersView` split into `src/components/redesign/cleaners/`. Roster data comes from a new set-returning `cleaner_scorecard(p_org_id)` RPC via a new `useAdminCleanerScorecards()` hook; pending invites come from the existing `useInvites`; detail workload/payouts load lazily. New `POST /api/admin/update-cleaner` and `POST /api/admin/cancel-invite` routes plus a `091` migration (`deactivated_at` + the RPC).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v3, Supabase (Postgres + Auth + Realtime), TanStack Query v5, Radix UI primitives in `src/components/ui/**`, Vitest (unit + integration), Playwright (e2e).

## Global Constraints

- No em dashes in any user-facing copy (labels, buttons, toasts, empty states). Use period, comma, parens, or "to".
- Dollars not cents in UI; descriptive status badges using the operator color hierarchy (amber = needs action, gray = settled, blue-spin = live, green = done, red = problem).
- `cleaner_profiles.id` IS the auth user id; `cleaner_id` FKs point at it. No separate `user_id`.
- NEVER read `cleaner_profiles.rating` / `total_jobs` (never written); derive from `appointments`. `reviews` has no write path, so the rating slot shows "No ratings yet".
- Org-scope every query/route. Gate permission BEFORE fetching roster data (data is app-grant protected, not RLS).
- New API routes get a co-located `*.integration.test.ts` using `tests/helpers/`. New pure logic gets a `*.test.ts`.
- Migrations are idempotent (`IF NOT EXISTS`) and must rebuild via `npx supabase db reset`. RPC hooks: RPC-first with a graceful fallback path.
- Server Stripe via `getStripe()`; never `new Stripe()`. Never import `supabase-admin` from client code.
- Everything ships under the `(redesign)` route group + `redesignUiEnabled()` flag (default off). Legacy pages stay until cutover.
- Anchored-left `max-w-[1700px]`; desktop table `lg:block`, mobile cards `lg:hidden`.

## Scope adjustments discovered during recon (vs the spec)

- **"Send setup link" admin action → deferred.** The existing `onboarding-link` route is self-only (cleaner onboards themselves). v1 surfaces the "Can't get paid" status (the high-value visibility); an admin-initiated reminder/link is a fast-follow needing a new route.
- **Bulk Set-payout-% → deferred.** v1 bulk action is Deactivate (the new high-value op). Per-cleaner payout-% edit lives in the detail Sheet. Legacy bulk payout mode stays available until cutover.
- **Assignment-dropdown exclusion of benched cleaners → fast-follow.** v1 adds `deactivated_at` + benches on this screen; filtering benched out of OTHER screens' cleaner pickers is a one-line follow-up once the column exists.

---

## Task 1: Migration 091 (deactivated_at + cleaner_scorecard RPC)

**Files:**
- Create: `supabase/migrations/091_cleaner_scorecard_and_deactivation.sql`

**Interfaces:**
- Produces: column `cleaner_profiles.deactivated_at timestamptz`; function `cleaner_scorecard(p_org_id uuid)` returning one row per cleaner with profile + aggregates.

- [ ] **Step 1: Write the migration**

```sql
-- 091_cleaner_scorecard_and_deactivation.sql
-- Soft-bench column + a set-returning per-cleaner scorecard for the operator
-- Cleaners & team screen. SECURITY INVOKER so the caller's RLS still governs
-- visibility (mirrors 049_dashboard_rpcs.sql). Never reads cleaner_profiles.rating
-- or .total_jobs (those columns are never written); derives counts from appointments.

ALTER TABLE public.cleaner_profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE OR REPLACE FUNCTION public.cleaner_scorecard(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  avatar_url text,
  payout_percent numeric,
  hourly_rate numeric,
  experience_years integer,
  bio text,
  is_available boolean,
  background_check_verified boolean,
  insurance_verified boolean,
  stripe_connect_account_id text,
  stripe_connect_onboarding_complete boolean,
  deactivated_at timestamptz,
  created_at timestamptz,
  total_jobs bigint,
  completed_jobs bigint,
  cancelled_jobs bigint,
  upcoming_jobs bigint,
  upcoming_this_week bigint,
  completed_this_week bigint,
  cleaner_earnings numeric,
  owed_now numeric,
  payouts_failed_count bigint
)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    cp.id,
    up.first_name,
    up.last_name,
    up.email,
    up.phone,
    up.avatar_url,
    coalesce(cp.payout_percent, 0)::numeric,
    cp.hourly_rate::numeric,
    cp.experience_years,
    cp.bio,
    cp.is_available,
    cp.background_check_verified,
    cp.insurance_verified,
    cp.stripe_connect_account_id,
    cp.stripe_connect_onboarding_complete,
    cp.deactivated_at,
    cp.created_at,
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id AND a.status = 'completed'),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id AND a.status = 'cancelled'),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id
         AND a.status IN ('pending','confirmed','in_progress')),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id
         AND a.status IN ('pending','confirmed','in_progress')
         AND a.scheduled_date >= current_date
         AND a.scheduled_date < current_date + interval '7 days'),
    (SELECT count(*) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id
         AND a.status = 'completed'
         AND a.scheduled_date >= current_date - interval '7 days'),
    (SELECT coalesce(sum(a.total_price), 0) FROM appointments a
       WHERE a.cleaner_id = cp.id AND a.organization_id = p_org_id AND a.status = 'completed')
      * coalesce(cp.payout_percent, 0) / 100.0,
    (SELECT coalesce(sum(pay.amount), 0) FROM payouts pay
       WHERE pay.cleaner_id = cp.id AND pay.status IN ('pending','approved','paid')),
    (SELECT count(*) FROM payouts pay
       WHERE pay.cleaner_id = cp.id AND pay.status IN ('failed','reversed'))
  FROM cleaner_profiles cp
  JOIN user_profiles up ON up.id = cp.id
  WHERE cp.organization_id = p_org_id
  ORDER BY up.first_name NULLS LAST, up.last_name NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.cleaner_scorecard(uuid) TO authenticated;
```

- [ ] **Step 2: Verify the enum has 'revoked' (for Task 3).** Grep `supabase/migrations/000_baseline.sql` for the invites status enum / check constraint. If `revoked` is NOT a valid value, append to this migration an idempotent widening (a CHECK-constraint swap, or `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'revoked'` run as its own statement). If it IS valid, no change.

- [ ] **Step 3: Rebuild schema (if Docker/Supabase available).** Run: `npx supabase db reset`. Expected: completes without error, `cleaner_scorecard` exists. If local Supabase is unavailable, note it; the migrate-dev pipeline applies on push.

- [ ] **Step 4: Commit.**
```bash
git add supabase/migrations/091_cleaner_scorecard_and_deactivation.sql
git commit -m "feat(db): cleaner_scorecard RPC + deactivated_at for Cleaners screen"
```

---

## Task 2: `POST /api/admin/update-cleaner` route + integration test

**Files:**
- Create: `src/app/api/admin/update-cleaner/route.ts`
- Test: `src/app/api/admin/update-cleaner/route.integration.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/update-cleaner`, body `{ cleanerId, profile?: { first_name?, last_name?, email?, phone? }, cleaner?: { payout_percent?, hourly_rate?, experience_years?, bio? }, deactivated?: boolean }`. Returns `{ success, error? }`. Derives org from the cleaner's own profile; authorizes via `requireOrgAuth(allowedRoles ['owner','admin','manager'])` + manager `can_manage_cleaners`. When `deactivated` is provided, sets/clears `cleaner_profiles.deactivated_at`.

- [ ] **Step 1: Write the integration test** (clone `delete-team-member/route.integration.test.ts` shape).

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('POST /api/admin/update-cleaner', () => {
  let org: TestOrgFixture; let org2: TestOrgFixture;
  beforeEach(async () => { org = await withTestOrg(); org2 = await withTestOrg(); });
  afterEach(async () => { await Promise.all([org.cleanup(), org2.cleanup()]); });

  it('rejects with no Authorization header', async () => {
    const { status } = await callRoute(POST, { method: 'POST',
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_percent: 50 } } });
    expect(status).toBe(401);
  });

  it('rejects a caller from a different org', async () => {
    const { status } = await callRoute(POST, { method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, cleaner: { payout_percent: 50 } } });
    expect(status).toBe(403);
  });

  it('admin updates payout_percent and contact', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(POST, { method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, profile: { phone: '555-0100' }, cleaner: { payout_percent: 65 } } });
    expect(status).toBe(200); expect(body.success).toBe(true);
    const admin = createTestSupabaseClient();
    const { data } = await admin.from('cleaner_profiles').select('payout_percent').eq('id', org.cleaner.userId).single();
    expect(Number(data?.payout_percent)).toBe(65);
  });

  it('admin deactivates then reactivates a cleaner', async () => {
    const admin = createTestSupabaseClient();
    await callRoute(POST, { method: 'POST', headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, deactivated: true } });
    let r = await admin.from('cleaner_profiles').select('deactivated_at').eq('id', org.cleaner.userId).single();
    expect(r.data?.deactivated_at).toBeTruthy();
    await callRoute(POST, { method: 'POST', headers: bearerHeader(org.admin.accessToken),
      body: { cleanerId: org.cleaner.userId, deactivated: false } });
    r = await admin.from('cleaner_profiles').select('deactivated_at').eq('id', org.cleaner.userId).single();
    expect(r.data?.deactivated_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (route not implemented). Run: `npm run test:integration -- update-cleaner`. Expected: FAIL (cannot import POST / 404). (Skip if local Supabase unavailable; note it.)

- [ ] **Step 3: Implement the route** (clone `update-manager-permissions` auth + `delete-cleaner` org-derivation).

```ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cleanerId, profile, cleaner, deactivated } = body ?? {};
    if (!cleanerId) {
      return NextResponse.json({ success: false, error: 'cleanerId is required' }, { status: 400 });
    }

    const { data: cleanerRow, error: lookupError } = await supabaseAdmin
      .from('cleaner_profiles').select('organization_id').eq('id', cleanerId).maybeSingle();
    if (lookupError) return NextResponse.json({ success: false, error: 'Failed to look up cleaner' }, { status: 500 });
    if (!cleanerRow) return NextResponse.json({ success: false, error: 'Cleaner not found' }, { status: 404 });

    const orgId = (cleanerRow as { organization_id: string }).organization_id;
    const auth = await requireOrgAuth(request, orgId, supabaseAdmin, { allowedRoles: ['owner', 'admin', 'manager'] });
    if (!auth.ok) return auth.response;
    if (auth.role === 'manager') {
      const { data: perms, error: permsErr } = await supabaseAdmin
        .from('manager_permissions').select('can_manage_cleaners')
        .eq('manager_id', auth.userId).eq('organization_id', orgId).maybeSingle();
      if (permsErr) return NextResponse.json({ success: false, error: 'Failed to check permissions' }, { status: 500 });
      if (perms?.can_manage_cleaners !== true) {
        return NextResponse.json({ success: false, error: 'Not authorized to manage cleaners' }, { status: 403 });
      }
    }

    // user_profiles fields
    if (profile && Object.keys(profile).length > 0) {
      const allowed: Record<string, unknown> = {};
      for (const k of ['first_name', 'last_name', 'email', 'phone'] as const) {
        if (profile[k] !== undefined) allowed[k] = profile[k];
      }
      if (Object.keys(allowed).length > 0) {
        allowed.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin.from('user_profiles').update(allowed).eq('id', cleanerId);
        if (error) return NextResponse.json({ success: false, error: `Failed to update profile: ${error.message}` }, { status: 500 });
      }
    }

    // cleaner_profiles fields + bench
    const cleanerUpdate: Record<string, unknown> = {};
    if (cleaner) {
      for (const k of ['payout_percent', 'hourly_rate', 'experience_years', 'bio'] as const) {
        if (cleaner[k] !== undefined) cleanerUpdate[k] = cleaner[k];
      }
    }
    if (deactivated !== undefined) {
      cleanerUpdate.deactivated_at = deactivated ? new Date().toISOString() : null;
    }
    if (Object.keys(cleanerUpdate).length > 0) {
      cleanerUpdate.updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('cleaner_profiles').update(cleanerUpdate).eq('id', cleanerId);
      if (error) return NextResponse.json({ success: false, error: `Failed to update cleaner: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test, verify pass** (if infra available). Run: `npm run test:integration -- update-cleaner`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add` route + test; `git commit -m "feat(api): update-cleaner route (edit profile, payout %, bench)"`.

---

## Task 3: `POST /api/admin/cancel-invite` route + integration test

**Files:**
- Create: `src/app/api/admin/cancel-invite/route.ts`
- Test: `src/app/api/admin/cancel-invite/route.integration.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/cancel-invite`, body `{ inviteId, organizationId }`. Returns `{ success, error? }`. `requireOrgAuth(['owner','admin','manager'])` + manager `can_manage_cleaners`. Sets `invites.status = 'revoked'` for a non-terminal invite in the org (idempotent on already-terminal).

- [ ] **Step 1: Write the integration test.** Seed an invite via `inviteTeamMember`/direct insert (use `createTestSupabaseClient()` to insert a `pending` invite row for `org`), assert: 401 no-token; 403 cross-org; 200 admin then read-back `status === 'revoked'`.
- [ ] **Step 2: Run, verify fail.** `npm run test:integration -- cancel-invite`. (Skip if no infra; note it.)
- [ ] **Step 3: Implement the route.**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export async function POST(request: NextRequest) {
  try {
    const { inviteId, organizationId } = (await request.json()) ?? {};
    if (!inviteId || !organizationId) {
      return NextResponse.json({ success: false, error: 'inviteId and organizationId are required' }, { status: 400 });
    }
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, { allowedRoles: ['owner', 'admin', 'manager'] });
    if (!auth.ok) return auth.response;
    if (auth.role === 'manager') {
      const { data: perms } = await supabaseAdmin
        .from('manager_permissions').select('can_manage_cleaners')
        .eq('manager_id', auth.userId).eq('organization_id', organizationId).maybeSingle();
      if (perms?.can_manage_cleaners !== true) {
        return NextResponse.json({ success: false, error: 'Not authorized to manage cleaners' }, { status: 403 });
      }
    }
    const { error } = await supabaseAdmin
      .from('invites').update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', inviteId).eq('organization_id', organizationId)
      .in('status', ['pending', 'creating', 'failed', 'expired']);
    if (error) return NextResponse.json({ success: false, error: `Failed to cancel invite: ${error.message}` }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run, verify pass** (if infra). **Step 5: Commit** route + test.

---

## Task 4: Types + data hooks (scorecard roster + detail)

**Files:**
- Modify: `src/types/index.ts` (add `'revoked'` to `InviteStatus`)
- Modify: `src/hooks/useAdminData.ts` (add `AdminCleanerScorecard`, `useAdminCleanerScorecards()`, `useCleanerWorkload()`, `updateCleaner()`, `cancelInvite()`)
- (No new test here; covered by Task 5 derive test + Task 2/3 route tests.)

**Interfaces:**
- Produces:
  - `interface AdminCleanerScorecard` = the RPC row shape (snake_case fields from Task 1) with `cleaner_earnings`, `owed_now` as numbers.
  - `useAdminCleanerScorecards(): { cleaners: AdminCleanerScorecard[]; loading; error; refetch; updateCleanerInState }` — calls `supabase.rpc('cleaner_scorecard', { p_org_id: orgId })`, key `keys.cleanerProfiles.scorecards(orgId)` (add to queryKeys), realtime on `cleaner_profiles:${orgId}` → invalidate.
  - `useCleanerWorkload(cleanerId): { upcoming: CleanerUpcomingJob[]; payouts: CleanerPayoutRow[]; loading }` — lazy (`enabled: !!cleanerId`), key `keys.cleanerProfiles.detail(id)`; loads upcoming appointments (`status in pending/confirmed/in_progress`, ordered by date) + payout rows grouped by status.
  - `updateCleaner(cleanerId, payload): Promise<{ success; error? }>` — POSTs `/api/admin/update-cleaner` with `Authorization: Bearer <session token>` (read via `supabase.auth.getSession()` like `deleteCustomers`).
  - `cancelInvite(inviteId, organizationId, accessToken): Promise<{ success; error? }>` — POSTs `/api/admin/cancel-invite`.
- Consumes: `keys.cleanerProfiles.*` (extend `queryKeys.ts` with `scorecards(orgId)`).

- [ ] **Step 1: Extend `src/lib/queryKeys.ts`** `cleanerProfiles` with `scorecards: (orgId: string) => ['cleaner-profiles', 'scorecards', orgId] as const`.
- [ ] **Step 2: Add `'revoked'` to `InviteStatus`** in `src/types/index.ts`: `export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'creating' | 'superseded' | 'failed' | 'expired';`
- [ ] **Step 3: Implement `AdminCleanerScorecard` + `useAdminCleanerScorecards`** in `useAdminData.ts` (mirror `useAdminCustomers`: RPC, map `Number(...)` coercions for the bigint/numeric fields, `updateCleanerInState`, realtime invalidate on `cleaner_profiles:${orgId}`). On RPC error return `[]` (the screen shows empty; no legacy fallback needed since this is new UI).
- [ ] **Step 4: Implement `useCleanerWorkload`** (clone `useCustomerDetails`: parallel `appointments` upcoming query + `payouts` by cleaner_id query; shape `CleanerUpcomingJob` = `{ id, scheduled_date, scheduled_time, status, service, property, total_price }`, `CleanerPayoutRow` = `{ id, amount, status, created_at }`).
- [ ] **Step 5: Implement `updateCleaner` + `cancelInvite`** helper functions (clone `deleteCustomers`' session-token-fetch + fetch pattern).
- [ ] **Step 6: `npx tsc --noEmit`** — no new errors. **Commit** `git commit -m "feat(hooks): cleaner scorecard + workload hooks and mutations"`.

---

## Task 5: `cleaners-types.ts` + `deriveCleaners.ts` (+ unit test) + `cleaners-presenters.tsx`

**Files:**
- Create: `src/components/redesign/cleaners/cleaners-types.ts`
- Create: `src/components/redesign/cleaners/deriveCleaners.ts`
- Create: `src/components/redesign/cleaners/deriveCleaners.test.ts`
- Create: `src/components/redesign/cleaners/cleaners-presenters.tsx`

**Interfaces:**
- Produces VM types: `CleanerSort` (`'name' | 'load' | 'earnings' | 'recent'`), `CLEANER_SORTS`, `CleanerStatus` (`'active' | 'benched'`), `ConnectState` (`'ready' | 'incomplete' | 'none'`), `PayoutHealth` (`'settled' | 'owed' | 'problem'`), `CleanerRowVM`, `PendingInviteRowVM`, `CleanerDetailVM`, `CleanerScorecardVM`, `CleanerUpcomingVM`, `CleanerRowAction` (`'open' | 'edit' | 'deactivate' | 'reactivate' | 'remove'`), `InviteRowAction` (`'resend' | 'cancel'`).
- `deriveCleaners(cleaners: AdminCleanerScorecard[], { search, sort, showBenched }): AdminCleanerScorecard[]` — filters out benched unless `showBenched`, free-text search over name/email/phone, sorts by the four keys (`load` = `upcoming_this_week` desc, `earnings` = `cleaner_earnings` desc, `name` asc, `recent` = `created_at` desc). Generic over a structural subset (like `deriveCustomers`).
- Presenters: `CleanerStatusBadge({ status })`, `ConnectBadge({ state })`, `PayoutHealthDot({ health })`, `InviteStatusBadge({ status })` (reuse the operator color hierarchy; Badge variants `caution`/`secondary`/`positive`/`critical`/`default`).

- [ ] **Step 1: Write `deriveCleaners.test.ts`** (clone `deriveCustomers.test.ts`): assert search matches name/email/phone; benched excluded unless `showBenched`; each sort orders correctly; input never mutated.
- [ ] **Step 2: Run, verify fail.** `npm run test:unit -- deriveCleaners`. Expected: FAIL (module missing).
- [ ] **Step 3: Write `cleaners-types.ts`, `deriveCleaners.ts`, `cleaners-presenters.tsx`.**
- [ ] **Step 4: Run, verify pass.** `npm run test:unit -- deriveCleaners`. Expected: PASS.
- [ ] **Step 5: Commit.**

---

## Task 6: Pure View tree (View + Table + CardList + BulkBar) + dev preview

**Files:**
- Create: `OperatorCleanersView.tsx`, `CleanersTable.tsx`, `CleanersCardList.tsx`, `CleanersBulkBar.tsx` (clone the Customers equivalents)
- Modify: the dev preview to render the View from mock VMs (mirror how `operator-preview` mounts the others)

**Clone deltas (from the matching `customers/*` files):**
- Header `<h1>Cleaners &amp; team</h1>`; subtitle live count `"{active} active · {pending} pending"`. Pending count comes in as a prop.
- Table columns: Cleaner (avatar + name + email) · Status badge · This week (`upcoming_this_week`) · Payout-health dot + earnings (gated `canViewPayments`) · Connect badge · actions menu. Drop Properties/Bookings/Total-spent columns.
- Row actions menu: Open, Edit, then Deactivate/Reactivate (depending on status), Remove (destructive).
- Render a **Pending invites group** above the active list: a labeled section of `PendingInviteRowVM` rows (email, role, invite status badge, "invited {date}", Resend + Cancel actions). View takes `pendingInvites`, `onInviteAction` props.
- `OperatorCleanersView` prop surface mirrors `OperatorCustomersViewProps` plus: `pendingInvites: PendingInviteRowVM[]`, `onInviteAction(inviteId, action)`, `showBenched: boolean`, `onToggleBenched()`, and bulk action is `onBulkDeactivate` (not delete).
- `CleanersBulkBar`: count + "Deactivate" + clear (clone `CustomersBulkBar`, swap label/icon to `UserMinus`).

- [ ] **Step 1: Write the four components** by cloning + applying deltas.
- [ ] **Step 2: Wire the dev preview** with mock cleaner + invite VMs so the screen renders standalone.
- [ ] **Step 3: `npx tsc --noEmit`** clean. **Step 4: Commit.**

---

## Task 7: `CleanerDetailSheet.tsx` + `AddCleanerDialog.tsx`

**Files:**
- Create: `CleanerDetailSheet.tsx`, `AddCleanerDialog.tsx`

**Clone deltas:**
- `AddCleanerDialog` = `AddCustomerDialog` with copy "New cleaner" and `onInvite` calling the cleaner invite (role `cleaner`). Email-only.
- `CleanerDetailSheet` (clone `CustomerDetailSheet`) sections:
  1. Header: avatar, name, `CleanerStatusBadge`, `ConnectBadge`.
  2. **Scorecard** stat boxes: Completed jobs, Completion rate (`completed/(completed+cancelled)`), Upcoming, This week, Lifetime earnings (gated), Pending owed (gated). A rating box renders the literal "No ratings yet".
  3. **Workload**: lazy `upcoming` list (reuse the simple row layout from the Sheet's history section), empty state "No upcoming jobs."
  4. **Payout health + Connect**: owed-now, failed-payout count if any, the 3-state Connect line. When not ready, a `caution`-styled callout: "This cleaner has not finished Stripe payout setup, so payouts are paused. They can finish it from their dashboard." (No action button in v1.)
  5. **Profile** inline edit (`onSave` returns `Promise<boolean>`): first/last/email/phone, payout %, hourly rate, experience years. Verification badges read-only (background check, insured, available).
  6. Footer: Edit, Deactivate/Reactivate, Remove (destructive via the container's ConfirmDialog).
- `CleanerSaveFields` = `{ first_name; last_name; email; phone; payout_percent; hourly_rate; experience_years }`.

- [ ] **Step 1: Write both components.** **Step 2: `tsc` clean.** **Step 3: Commit.**

---

## Task 8: Gate + container (`OperatorCleaners.tsx`) with mutations + realtime

**Files:**
- Create: `OperatorCleaners.tsx` (gate `OperatorCleaners` + inner `OperatorCleanersData`)

**Clone deltas (from `OperatorCustomers.tsx`):**
- Gate: `canManage = privileged || permissions?.can_manage_cleaners`; deny EmptyState copy "You do not have access to cleaners". Pass `canViewPayments = privileged || can_view_payments`, `canEdit = canManage`.
- Container consumes `useAdminCleanerScorecards()`, `useCleanerWorkload(detailId)`, and `useInvites(currentOrganizationId, accessToken, { enabled: true })`. Derive `pendingInvites` = invites filtered `role==='cleaner'` and `status in ['pending','creating','failed','expired']`, mapped to `PendingInviteRowVM`.
- VM mappers `toCleanerRowVM` (status from `deactivated_at`, payout health from `owed_now`/`payouts_failed_count`, connect from the two cached columns, earnings gated), `toCleanerDetailVM`, `toScorecardVM`, `toUpcomingVM`.
- State adds `showBenched`, and the sort default `'name'`.
- Mutations: `handleSave` → `updateCleaner`; `handleInvite` → `inviteTeamMember({ role: 'cleaner' })`; `handleInviteAction` → resend (`useInvites().resend`) or `cancelInvite`; deactivate/reactivate → `updateCleaner({ deactivated })` then `refetch`; remove → `deleteCleaner`-style call to `DELETE /api/admin/delete-cleaner?id=` (add a `deleteCleaner(id)` helper or inline fetch); bulk deactivate → loop/sequential `updateCleaner({ deactivated: true })` then `refetch` + clearSelection.
- Carry over the prune-selection-to-visible `useEffect`.
- Render `OperatorCleanersView` + `CleanerDetailSheet` + `AddCleanerDialog` + `ConfirmDialog` (confirm copy for deactivate/remove/bulk-deactivate).

- [ ] **Step 1: Write the container + gate.** **Step 2: `tsc` clean.** **Step 3: Commit.**

---

## Task 9: Route page + nav repoint

**Files:**
- Create: `src/app/(redesign)/app/admin-dashboard/cleaners/page.tsx` (clone the customers `page.tsx`, `active="cleaners"`, render `<OperatorCleaners />`)
- Modify: `src/components/redesign/shell/nav-items.ts` (repoint `cleaners` href to `/app/admin-dashboard/cleaners`)

- [ ] **Step 1: Write the page** + repoint nav. **Step 2: `tsc` + `npm run lint`** clean. **Step 3: Commit.**

---

## Task 10: Verify in the running app + polish

- [ ] **Step 1: Run dev** (`npm run dev`) with the redesign flag enabled; navigate to `/app/admin-dashboard/cleaners` (or via the rail). Use Playwright MCP to screenshot desktop + mobile widths.
- [ ] **Step 2: Exercise** open a cleaner (scorecard + workload + payout health render), inline edit, deactivate/reactivate, send + cancel an invite, search + each sort, bulk deactivate, benched filter.
- [ ] **Step 3: Polish** spacing/empty-states/badges to feel native (use `ui-ux-pro-max` rules + iterate). **Step 4: Commit.**

---

## Final gates (before PR)

- [ ] `npm run test` (unit + integration) green where infra allows; at minimum `npm run test:unit` green.
- [ ] `npx tsc --noEmit` introduces no new errors.
- [ ] `npm run lint` clean for new files.
- [ ] `npx supabase db reset` rebuilds cleanly (if Docker available) including 091.
- [ ] Codex review on the finished branch (`/codex:review --scope branch --base master --wait`), apply valid findings as a follow-up commit.
- [ ] Push, open PR to master.

## Self-review against the spec

- Spec §4 IA → Tasks 5-9. §5 gating → Task 8 gate. §6 data → Task 4 + Task 1 RPC. §7 roster → Task 6. §8 detail Sheet → Task 7. §9 invites → Tasks 3, 6, 8. §10 backend → Tasks 1-3. §11 VM types → Task 5. §12 realtime → Task 4. §13 testing → Tasks 2,3,5,10. §15 rollout → Task 9. Scope adjustments (Send-link, bulk-payout, assignment exclusion) explicitly deferred above.
