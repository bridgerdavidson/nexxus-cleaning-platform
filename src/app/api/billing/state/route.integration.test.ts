import { describe, expect, it } from 'vitest';
import { GET } from './route';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();

/**
 * withTestOrg()'s `admin` handle is seeded as org role 'admin', not 'owner'.
 * Same helper as src/app/api/billing/trial/extend/route.integration.test.ts.
 */
async function setRole(organizationId: string, userId: string, role: string) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error) throw new Error(`set role failed: ${error.message}`);
}

function get(token: string, organizationId?: string) {
  const qs = organizationId ? `?organization_id=${organizationId}` : '';
  return callRoute(GET, {
    method: 'GET',
    url: `http://localhost/api/billing/state${qs}`,
    headers: bearerHeader(token),
  });
}

describe('GET /api/billing/state', () => {
  it('returns the raw billing row, seats in use and the caller role', async () => {
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'owner');
      const res = await get(org.admin.accessToken, org.organizationId);

      expect(res.status).toBe(200);
      const body = res.body as { success: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      // withTestOrg stamps a live 14-day trial (PR D changed the fixture default).
      const billing = body.data.billing as Record<string, unknown>;
      expect(billing.subscription_status).toBe('trialing');
      expect(billing.trial_ends_at).toEqual(expect.any(String));
      expect(body.data.role).toBe('owner');
      expect(typeof body.data.seats_in_use).toBe('number');
    } finally {
      await org.cleanup();
    }
  });

  it('returns every column deriveBillingAccess needs, plus the renewal date', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.admin.accessToken, org.organizationId);
      const data = (res.body as { data: Record<string, unknown> }).data;
      const billing = data.billing as Record<string, unknown>;

      for (const col of [
        'subscription_status', 'trial_ends_at', 'trial_extended_at', 'comped_at',
        'plan_tier', 'billing_period', 'seat_count', 'subscription_cancel_at',
        'billing_paused_at', 'billing_pause_resumes_at',
      ]) {
        expect(billing).toHaveProperty(col);
      }
      // Sits OUTSIDE `billing` on purpose: not in ORG_BILLING_COLUMNS, because
      // deriveBillingAccess never reads it. Task 9 renders it as "Renews on".
      expect(data).toHaveProperty('current_period_end');
    } finally {
      await org.cleanup();
    }
  });

  it('allows an admin and reports their role', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(200);
      expect((res.body as { data: { role: string } }).data.role).toBe('admin');
    } finally {
      await org.cleanup();
    }
  });

  it('allows a manager, because a frozen manager must learn why work is blocked', async () => {
    const org = await withTestOrg();
    try {
      await setRole(org.organizationId, org.admin.userId, 'manager');
      const res = await get(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(200);
      expect((res.body as { data: { role: string } }).data.role).toBe('manager');
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a cleaner', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.cleaner.accessToken, org.organizationId);
      expect(res.status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it('rejects a member of another org', async () => {
    const orgA = await withTestOrg();
    const orgB = await withTestOrg();
    try {
      const res = await get(orgB.admin.accessToken, orgA.organizationId);
      expect(res.status).toBe(403);
    } finally {
      await orgB.cleanup();
      await orgA.cleanup();
    }
  });

  /**
   * Beyond the brief's list, and deliberately so. The brief asserts only
   * `toHaveProperty('current_period_end')` and `typeof seats_in_use === 'number'`,
   * and both of those pass against a stub that hardcodes `null` and `0`: the fixture
   * org has no period end, so the shape-only check can never tell a real read from a
   * constant. This one seeds a real value and counts a real seat.
   */
  it('reads subscription_current_period_end from the row and counts real seats', async () => {
    const org = await withTestOrg();
    try {
      const renewsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const { error } = await supabase
        .from('organizations')
        .update({ subscription_current_period_end: renewsAt })
        .eq('id', org.organizationId);
      if (error) throw new Error(`seed period end failed: ${error.message}`);

      const res = await get(org.admin.accessToken, org.organizationId);
      const data = (res.body as {
        data: { current_period_end: string | null; seats_in_use: number };
      }).data;

      expect(data.current_period_end).not.toBeNull();
      expect(new Date(data.current_period_end!).getTime()).toBe(new Date(renewsAt).getTime());
      // withTestOrg seeds exactly one cleaner member and no pending invites.
      expect(data.seats_in_use).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it('400s without organization_id', async () => {
    const org = await withTestOrg();
    try {
      const res = await get(org.admin.accessToken);
      expect(res.status).toBe(400);
    } finally {
      await org.cleanup();
    }
  });
});
