import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DELETE } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, addOwnerToOrg, createTestAppointment, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('DELETE /api/admin/delete-team-member', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    org = await withTestOrg();
    org2 = await withTestOrg();
  });

  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  it('rejects request with no Authorization header (proves the bug)', async () => {
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      body: { userId: org.cleaner.userId, organizationId: org.organizationId },
    });
    expect(status).toBe(401);

    // Sanity: cleaner still exists
    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', org.cleaner.userId)
      .eq('organization_id', org.organizationId)
      .maybeSingle();
    expect(data).toBeTruthy();
  });

  it('rejects non-admin org member (cleaner trying to delete another user)', async () => {
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { userId: org.homeowner.userId, organizationId: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('rejects caller from a different org', async () => {
    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org2.admin.accessToken),
      body: { userId: org.cleaner.userId, organizationId: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('admin successfully deletes a cleaner with no active appointments', async () => {
    const { status, body } = await callRoute<{ success: boolean }>(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      body: { userId: org.cleaner.userId, organizationId: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', org.cleaner.userId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('refuses to delete the organization owner (an admin cannot remove the owner)', async () => {
    const owner = await addOwnerToOrg(org.organizationId);
    try {
      const { status, body } = await callRoute<{ success: boolean; error: string }>(DELETE, {
        method: 'DELETE',
        headers: bearerHeader(org.admin.accessToken),
        body: { userId: owner.userId, organizationId: org.organizationId },
      });
      expect(status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/owner/i);

      // Owner membership untouched, auth user still present.
      const admin = createTestSupabaseClient();
      const { data } = await admin
        .from('organization_members')
        .select('user_id')
        .eq('user_id', owner.userId)
        .eq('organization_id', org.organizationId)
        .maybeSingle();
      expect(data).toBeTruthy();
    } finally {
      await owner.cleanup();
    }
  });

  it('refuses to delete a cleaner with active appointments', async () => {
    await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
    });

    const { status, body } = await callRoute<{ success: boolean; error: string }>(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
      body: { userId: org.cleaner.userId, organizationId: org.organizationId },
    });
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/active appointment/i);
  });
});
