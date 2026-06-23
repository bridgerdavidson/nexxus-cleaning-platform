import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/** Seed a pending invite row directly (service role) and return its id. */
async function seedPendingInvite(org: TestOrgFixture, email: string): Promise<string> {
  const admin = createTestSupabaseClient();
  const { data, error } = await admin
    .from('invites')
    .insert({
      organization_id: org.organizationId,
      email: email.toLowerCase(),
      role: 'cleaner',
      status: 'pending',
      invited_by: org.admin.userId,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data!.id as string;
}

describe('POST /api/admin/cancel-invite', () => {
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
    const inviteId = await seedPendingInvite(org, 'pending-noauth@test.local');
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { inviteId, organizationId: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('rejects a caller from a different org', async () => {
    const inviteId = await seedPendingInvite(org, 'pending-crossorg@test.local');
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org2.admin.accessToken),
      body: { inviteId, organizationId: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('admin revokes a pending invite', async () => {
    const inviteId = await seedPendingInvite(org, 'pending-revoke@test.local');
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { inviteId, organizationId: org.organizationId },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const admin = createTestSupabaseClient();
    const { data } = await admin.from('invites').select('status').eq('id', inviteId).single();
    expect(data?.status).toBe('revoked');
  });
});
