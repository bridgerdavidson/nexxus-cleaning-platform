import { describe, expect, it } from 'vitest';
import { POST } from './route';
import { withTestOrg } from '@/../tests/helpers/fixtures';
import { bearerHeader, callRoute } from '@/../tests/helpers/auth';
import { createTestSupabaseClient } from '@/../tests/helpers/supabase';

const supabase = createTestSupabaseClient();
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function extend(token: string, organizationId: string) {
  return callRoute(POST, {
    method: 'POST',
    headers: bearerHeader(token),
    body: { organization_id: organizationId },
  });
}

/**
 * withTestOrg()'s `admin` handle is seeded as org role 'admin', not 'owner'
 * (tests/helpers/fixtures.ts inserts organization_members with role: 'admin'
 * for it). The trial-extend route is owner only (an admin can open checkout
 * but cannot move the trial clock), so every test that expects a successful
 * extension promotes that member to 'owner' first rather than weakening the
 * route to accept admins.
 */
async function promoteToOwner(organizationId: string, userId: string) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role: 'owner' })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error) throw new Error(`promote to owner failed: ${error.message}`);
}

describe('POST /api/billing/trial/extend', () => {
  it('adds 7 days to a running trial and stamps the one-time flag', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(2) } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      const res = await extend(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(200);

      const { data } = await supabase
        .from('organizations')
        .select('trial_ends_at, trial_extended_at')
        .eq('id', org.organizationId)
        .single();

      const expected = Date.now() + 9 * 86_400_000; // 2 remaining + 7
      expect(Math.abs(new Date(data!.trial_ends_at!).getTime() - expected)).toBeLessThan(60_000);
      expect(data!.trial_extended_at).not.toBeNull();
    } finally {
      await org.cleanup();
    }
  });

  it('extends from today when the trial already expired', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(-10) } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await extend(org.admin.accessToken, org.organizationId);
      const { data } = await supabase
        .from('organizations')
        .select('trial_ends_at')
        .eq('id', org.organizationId)
        .single();

      const expected = Date.now() + 7 * 86_400_000;
      expect(Math.abs(new Date(data!.trial_ends_at!).getTime() - expected)).toBeLessThan(60_000);
    } finally {
      await org.cleanup();
    }
  });

  it('allows it exactly once', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(3) } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      expect((await extend(org.admin.accessToken, org.organizationId)).status).toBe(200);

      const second = await extend(org.admin.accessToken, org.organizationId);
      expect(second.status).toBe(409);
      expect((second.body as { error: string }).error).toBe('This trial has already been extended.');
    } finally {
      await org.cleanup();
    }
  });

  it('a losing concurrent request gets the same 409, not a false 200, and writes no extra audit row', async () => {
    // Both requests read canExtendTrial: true before either writes; only the
    // `.is('trial_extended_at', null)` guard on the UPDATE decides a winner.
    // Fired via Promise.all against the same org so the two reads genuinely
    // race the same way two simultaneous clicks would.
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(2) } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      const [a, b] = await Promise.all([
        extend(org.admin.accessToken, org.organizationId),
        extend(org.admin.accessToken, org.organizationId),
      ]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect((loser.body as { error: string }).error).toBe('This trial has already been extended.');

      const { data: events } = await supabase
        .from('tenant_subscription_events')
        .select('event_type')
        .eq('organization_id', org.organizationId)
        .eq('event_type', 'app.trial_extended');
      expect(events?.length).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it('refuses when there is no trial to extend', async () => {
    const org = await withTestOrg({ billing: { subscription_status: 'active', trial_ends_at: null } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      const res = await extend(org.admin.accessToken, org.organizationId);
      expect(res.status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it('refuses a comped org, which has no trial clock', async () => {
    const org = await withTestOrg({ billing: { comped_at: new Date().toISOString() } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      expect((await extend(org.admin.accessToken, org.organizationId)).status).toBe(409);
    } finally {
      await org.cleanup();
    }
  });

  it('is owner only', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(2) } });
    try {
      // org.cleaner stays a plain cleaner; not promoted.
      expect((await extend(org.cleaner.accessToken, org.organizationId)).status).toBe(403);
    } finally {
      await org.cleanup();
    }
  });

  it('401s without a token and 400s without an organization id', async () => {
    expect(
      (await callRoute(POST, { method: 'POST', body: { organization_id: crypto.randomUUID() } })).status,
    ).toBe(401);

    const org = await withTestOrg();
    try {
      expect(
        (
          await callRoute(POST, {
            method: 'POST',
            headers: bearerHeader(org.admin.accessToken),
            body: {},
          })
        ).status,
      ).toBe(400);
    } finally {
      await org.cleanup();
    }
  });

  it('writes an audit row', async () => {
    const org = await withTestOrg({ billing: { trial_ends_at: daysFromNow(2) } });
    try {
      await promoteToOwner(org.organizationId, org.admin.userId);
      await extend(org.admin.accessToken, org.organizationId);
      const { data } = await supabase
        .from('tenant_subscription_events')
        .select('event_type')
        .eq('organization_id', org.organizationId);

      expect(data?.map((r) => r.event_type)).toContain('app.trial_extended');
    } finally {
      await org.cleanup();
    }
  });
});
