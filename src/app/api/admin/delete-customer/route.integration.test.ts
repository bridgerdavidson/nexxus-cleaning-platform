import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addManagerToOrg,
  addHomeownerToOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

interface DeleteResult {
  id: string;
  status: 'deleted' | 'blocked' | 'error';
  reason?: string;
}
type DeleteBody = { success: boolean; error?: string; results?: DeleteResult[] };

describe('DELETE /api/admin/delete-customer', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects a request with no Authorization header', async () => {
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      body: { organizationId: org.organizationId, customerIds: [org.homeowner.userId] },
    });
    expect(status).toBe(401);

    // Sanity: homeowner untouched.
    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId)
      .maybeSingle();
    expect(data).toBeTruthy();
  });

  it('rejects a cleaner (insufficient role)', async () => {
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { organizationId: org.organizationId, customerIds: [org.homeowner.userId] },
    });
    expect(status).toBe(403);
  });

  it('rejects a manager without can_edit_customers', async () => {
    const manager = await addManagerToOrg(org.organizationId, {});
    try {
      const { status, body } = await callRoute<DeleteBody>(DELETE, {
        method: 'DELETE',
        headers: bearerHeader(manager.accessToken),
        body: { organizationId: org.organizationId, customerIds: [org.homeowner.userId] },
      });
      expect(status).toBe(403);
      expect(body.success).toBe(false);
    } finally {
      await manager.cleanup();
    }
  });

  it('lets a manager with can_edit_customers delete a clean customer', async () => {
    const manager = await addManagerToOrg(org.organizationId, { can_edit_customers: true });
    try {
      const { status, body } = await callRoute<DeleteBody>(DELETE, {
        method: 'DELETE',
        headers: bearerHeader(manager.accessToken),
        body: { organizationId: org.organizationId, customerIds: [org.homeowner.userId] },
      });
      expect(status).toBe(200);
      expect(body.results?.[0]?.status).toBe('deleted');

      const admin = createTestSupabaseClient();
      const { data } = await admin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', org.homeowner.userId)
        .maybeSingle();
      expect(data).toBeNull();
    } finally {
      await manager.cleanup();
    }
  });

  it('hard-deletes a clean customer: membership, profile, invite, and auth user all gone', async () => {
    const admin = createTestSupabaseClient();

    // Seed a pending invite for this customer's email — it should be cleaned up.
    const { error: inviteErr } = await admin.from('invites').insert({
      organization_id: org.organizationId,
      email: org.homeowner.email,
      role: 'homeowner',
      status: 'pending',
      invited_by: org.admin.userId,
    });
    expect(inviteErr).toBeNull();

    const { status, body } = await callRoute<DeleteBody>(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId, customerIds: [org.homeowner.userId] },
    });
    expect(status).toBe(200);
    expect(body.results?.[0]?.status).toBe('deleted');

    const { data: member } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', org.homeowner.userId)
      .maybeSingle();
    expect(member).toBeNull();

    const { data: profile } = await admin
      .from('user_profiles')
      .select('id')
      .eq('id', org.homeowner.userId)
      .maybeSingle();
    expect(profile).toBeNull();

    const { data: invites } = await admin
      .from('invites')
      .select('id')
      .eq('organization_id', org.organizationId)
      .eq('email', org.homeowner.email);
    expect(invites ?? []).toHaveLength(0);

    // The actual bug fix: the auth user is gone, freeing the email for re-invite.
    const { data: authData } = await admin.auth.admin.getUserById(org.homeowner.userId);
    expect(authData?.user ?? null).toBeNull();
  });

  it('blocks deletion of a customer with booking history (preserves records)', async () => {
    await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'completed',
    });

    const { status, body } = await callRoute<DeleteBody>(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId, customerIds: [org.homeowner.userId] },
    });
    expect(status).toBe(200);
    expect(body.results?.[0]?.status).toBe('blocked');
    expect(body.results?.[0]?.reason).toMatch(/booking/i);

    // Still present.
    const admin = createTestSupabaseClient();
    const { data: member } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId)
      .maybeSingle();
    expect(member).toBeTruthy();
    const { data: profile } = await admin
      .from('user_profiles')
      .select('id')
      .eq('id', org.homeowner.userId)
      .maybeSingle();
    expect(profile).toBeTruthy();
  });

  it('bulk delete: deletes clean customers and blocks ones with history', async () => {
    const clean = await addHomeownerToOrg(org.organizationId);
    try {
      // org.homeowner gets history; `clean` stays clean.
      await createTestAppointment({
        organizationId: org.organizationId,
        cleanerId: org.cleaner.userId,
        homeownerId: org.homeowner.userId,
        status: 'completed',
      });

      const { status, body } = await callRoute<DeleteBody>(DELETE, {
        method: 'DELETE',
        headers: bearerHeader(org.admin.accessToken),
        body: {
          organizationId: org.organizationId,
          customerIds: [clean.userId, org.homeowner.userId],
        },
      });
      expect(status).toBe(200);
      expect(body.results).toHaveLength(2);

      const byId = Object.fromEntries((body.results ?? []).map((r) => [r.id, r.status]));
      expect(byId[clean.userId]).toBe('deleted');
      expect(byId[org.homeowner.userId]).toBe('blocked');

      const admin = createTestSupabaseClient();
      const { data: cleanMember } = await admin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', clean.userId)
        .maybeSingle();
      expect(cleanMember).toBeNull();
      const { data: historyMember } = await admin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', org.homeowner.userId)
        .maybeSingle();
      expect(historyMember).toBeTruthy();
    } finally {
      await clean.cleanup();
    }
  });

  it('multi-org safety: a customer in another org keeps their account', async () => {
    const admin = createTestSupabaseClient();
    // org.homeowner is also a member of org2.
    const { error: memErr } = await admin
      .from('organization_members')
      .insert({ user_id: org.homeowner.userId, organization_id: org2.organizationId, role: 'homeowner' });
    expect(memErr).toBeNull();

    const { status, body } = await callRoute<DeleteBody>(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      body: { organizationId: org.organizationId, customerIds: [org.homeowner.userId] },
    });
    expect(status).toBe(200);
    expect(body.results?.[0]?.status).toBe('deleted');

    // Removed from org, but retained in org2 with profile + auth user intact.
    const { data: orgMember } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org.organizationId)
      .maybeSingle();
    expect(orgMember).toBeNull();

    const { data: org2Member } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', org.homeowner.userId)
      .eq('organization_id', org2.organizationId)
      .maybeSingle();
    expect(org2Member).toBeTruthy();

    const { data: profile } = await admin
      .from('user_profiles')
      .select('id')
      .eq('id', org.homeowner.userId)
      .maybeSingle();
    expect(profile).toBeTruthy();

    const { data: authData } = await admin.auth.admin.getUserById(org.homeowner.userId);
    expect(authData?.user ?? null).toBeTruthy();
  });
});
