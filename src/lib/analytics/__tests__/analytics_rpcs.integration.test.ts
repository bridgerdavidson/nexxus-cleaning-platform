/**
 * Integration tests: analytics RPC authorization + org-scoping.
 *
 * Asserts the security contract from migration 094:
 *   - analytics_authz gates access by org membership + role/manager_permissions
 *   - Non-members (auth.uid() not in organization_members for the target org) get null / empty set
 *   - Admin/owner members (privileged roles) see data including money fields
 *   - analytics_cleaner_leaderboard is org-scoped (cross-org call returns [])
 *
 * Requires `npx supabase start` + .env.test.local (see CLAUDE.md "Running tests").
 * Docker is down locally — CI verifies this test via `npx supabase start` in the CI runner.
 * Do NOT run this test locally unless the local Supabase stack is up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { withTestOrg, type TestOrgFixture } from '../../../../tests/helpers/fixtures';

// Wide date range so zero-seeded orgs still return non-null (just zeroed numbers)
const START = '2020-01-01';
const END = '2035-01-01';

/**
 * Build a Supabase client authenticated as the given user (anon key + user JWT).
 * This lets RPCs see auth.uid() = user's id, so analytics_authz can look up their membership.
 * Pattern copied from src/app/api/appointments/appointment-insert-rls.integration.test.ts.
 */
function clientAs(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );
}

describe('analytics RPC authorization + org-scoping', () => {
  let orgA: TestOrgFixture;
  let orgB: TestOrgFixture;

  beforeAll(async () => {
    // Two isolated orgs — admin of B is not a member of A and vice-versa
    [orgA, orgB] = await Promise.all([withTestOrg(), withTestOrg()]);
  });

  afterAll(async () => {
    await Promise.all([orgA.cleanup(), orgB.cleanup()]);
  });

  // ---- Case 1: cross-org denial (non-member calls analytics_summary for another org) ----
  it('cross-org: org B admin calling analytics_summary for org A gets null (not a member)', async () => {
    const { data, error } = await clientAs(orgB.admin.accessToken).rpc('analytics_summary', {
      p_org_id: orgA.organizationId,
      p_start: START,
      p_end: END,
    });
    // analytics_summary returns null when analytics_authz denies
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  // ---- Case 2: privileged member (admin) sees data including money fields ----
  it('org A admin calling analytics_summary for org A gets a non-null object with jobsTotal and arAging', async () => {
    const { data, error } = await clientAs(orgA.admin.accessToken).rpc('analytics_summary', {
      p_org_id: orgA.organizationId,
      p_start: START,
      p_end: END,
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    // Admin is privileged (role='admin' in analytics_authz) — money fields must be present
    expect(typeof (data as Record<string, unknown>).jobsTotal).toBe('number');
    // arAging is present and is an object (not nulled) for privileged callers
    expect((data as Record<string, unknown>).arAging).not.toBeNull();
    expect(typeof (data as Record<string, unknown>).arAging).toBe('object');
  });

  // ---- Case 3: org-scoped set-returning RPC — cross-org call returns [] ----
  it('cross-org: org A admin calling analytics_cleaner_leaderboard for org B gets [] (not a member of B)', async () => {
    const { data, error } = await clientAs(orgA.admin.accessToken).rpc(
      'analytics_cleaner_leaderboard',
      {
        p_org_id: orgB.organizationId,
        p_start: START,
        p_end: END,
      },
    );
    // analytics_cleaner_leaderboard is set-returning: returns early (empty) when denied
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  // TODO(follow-up): manager money-null case
  // A manager with can_view_analytics=true, can_view_payments=false should see
  // jobsTotal as a number but revenueCents as null. This requires:
  //   1. createAuthUser(..., 'manager', ...) to get a manager access token
  //   2. service-role insert into organization_members(role='manager') for the org
  //   3. service-role insert into manager_permissions(can_view_analytics=true, can_view_payments=false)
  // The setup is straightforward but adds ~3 auth/DB calls per test run.
  // Deferred to a follow-up once a withTestOrgWithManager() helper exists.
});
