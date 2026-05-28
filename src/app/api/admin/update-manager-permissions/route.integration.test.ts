import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createAuthUser,
  type TestOrgFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/** Seeds an OrgRole 'manager' member (withTestOrg only seeds admin/cleaner/homeowner). */
async function addManager(organizationId: string) {
  const db = createTestSupabaseClient();
  const email = `manager-${randomUUID().slice(0, 8)}@test.local`;
  const mgr = await createAuthUser(email, 'manager', 'Manager');
  const { error: profileErr } = await db.from('user_profiles').upsert(
    { id: mgr.id, email, first_name: 'Manny', last_name: 'Manager', role: 'manager' },
    { onConflict: 'id' },
  );
  if (profileErr) throw new Error(`seed manager profile failed: ${profileErr.message}`);
  const { error: memErr } = await db
    .from('organization_members')
    .insert({ user_id: mgr.id, organization_id: organizationId, role: 'manager' });
  if (memErr) throw new Error(`seed manager member failed: ${memErr.message}`);
  return {
    ...mgr,
    async cleanup() {
      await db.auth.admin.deleteUser(mgr.id);
    },
  };
}

/**
 * Security regression: update-manager-permissions had NO caller auth — anyone
 * who could reach it could grant any manager arbitrary permissions in any org.
 * It now requires the caller to be an owner/admin of the target org.
 */
describe('POST /api/admin/update-manager-permissions (authorization)', () => {
  let org: TestOrgFixture | null = null;
  let manager: Awaited<ReturnType<typeof addManager>> | null = null;

  afterEach(async () => {
    await manager?.cleanup();
    await org?.cleanup();
    manager = null;
    org = null;
  });

  const reqBody = (managerId: string, organizationId: string) => ({
    managerId,
    organizationId,
    can_view_bookings: true,
  });

  it('401 without a token', async () => {
    org = await withTestOrg();
    manager = await addManager(org.organizationId);
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: reqBody(manager.id, org.organizationId),
    });
    expect(status).toBe(401);
  });

  it('rejects a cleaner (403)', async () => {
    org = await withTestOrg();
    manager = await addManager(org.organizationId);
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: reqBody(manager.id, org.organizationId),
    });
    expect(status).toBe(403);
  });

  it('lets the org admin update a manager’s permissions (200)', async () => {
    org = await withTestOrg();
    manager = await addManager(org.organizationId);
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: reqBody(manager.id, org.organizationId),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('manager_permissions')
      .select('can_view_bookings')
      .eq('manager_id', manager.id)
      .eq('organization_id', org.organizationId)
      .maybeSingle();
    expect((data as { can_view_bookings: boolean }).can_view_bookings).toBe(true);
  });
});
