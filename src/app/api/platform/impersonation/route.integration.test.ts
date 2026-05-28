import { describe, it, expect, afterEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  createTestAppointment,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

/** Anon-key client carrying a specific user's JWT, so RLS evaluates as that user. */
function anonAs(token: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

describe('POST /api/platform/impersonation (audit)', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    const db = createTestSupabaseClient();
    if (admin) await db.from('platform_audit_log').delete().eq('actor_user_id', admin.userId);
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('rejects a non-platform-admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { action: 'start', organization_id: org.organizationId },
    });
    expect(status).toBe(403);
  });

  it('400s without an organization_id', async () => {
    admin = await withPlatformAdmin();
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(admin.accessToken),
      body: { action: 'start' },
    });
    expect(status).toBe(400);
  });

  it('records an impersonation_start audit row', async () => {
    [admin, org] = await Promise.all([withPlatformAdmin(), withTestOrg()]);
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(admin.accessToken),
      body: { action: 'start', organization_id: org.organizationId },
    });
    expect(status).toBe(200);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('platform_audit_log')
      .select('action, target_org_id')
      .eq('actor_user_id', admin.userId);
    const rows = (data ?? []) as { action: string; target_org_id: string }[];
    expect(rows.some((r) => r.action === 'impersonation_start' && r.target_org_id === org!.organizationId)).toBe(true);
  });
});

describe('platform-admin cross-org read RLS (migration 069)', () => {
  let admin: PlatformAdminFixture | null = null;
  let orgA: TestOrgFixture | null = null;
  let orgB: TestOrgFixture | null = null;
  let apptId: string | null = null;

  afterEach(async () => {
    await Promise.all([admin?.cleanup(), orgA?.cleanup(), orgB?.cleanup()]);
    admin = null;
    orgA = null;
    orgB = null;
    apptId = null;
  });

  it('lets a platform admin read another org, blocks a normal member, and is read-only', async () => {
    [admin, orgA, orgB] = await Promise.all([withPlatformAdmin(), withTestOrg(), withTestOrg()]);
    const appt = await createTestAppointment({
      organizationId: orgA.organizationId,
      cleanerId: orgA.cleaner.userId,
      homeownerId: orgA.homeowner.userId,
    });
    apptId = appt.id;

    // Platform admin (UserRole 'homeowner' + platform_admins row) can SELECT orgA's appointment.
    const adminClient = anonAs(admin.accessToken);
    const { data: adminRead } = await adminClient
      .from('appointments')
      .select('id')
      .eq('id', apptId);
    expect((adminRead ?? []).length).toBe(1);

    // A homeowner from orgB (no platform_admins row, not a member of orgA, not
    // covered by the admin god-mode policy) cannot see orgA's appointment.
    const outsiderClient = anonAs(orgB.homeowner.accessToken);
    const { data: outsiderRead } = await outsiderClient
      .from('appointments')
      .select('id')
      .eq('id', apptId);
    expect((outsiderRead ?? []).length).toBe(0);

    // Impersonation is read-only: the platform admin has no write policy, so the
    // UPDATE matches no rows and the appointment is unchanged.
    const { data: updated } = await adminClient
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', apptId)
      .select('id');
    expect((updated ?? []).length).toBe(0);

    const db = createTestSupabaseClient();
    const { data: after } = await db
      .from('appointments')
      .select('status')
      .eq('id', apptId)
      .single();
    expect((after as { status: string }).status).not.toBe('completed');
  });
});
