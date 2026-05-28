import { describe, it, expect, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { DELETE, GET } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  createTestAppointment,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../../tests/helpers/supabase';
import type { PlatformOrgDetail } from '@/types/platform';

const getHandler = (id: string) => (req: NextRequest) =>
  GET(req, { params: Promise.resolve({ id }) });
const deleteHandler = (id: string) => (req: NextRequest) =>
  DELETE(req, { params: Promise.resolve({ id }) });

describe('GET /api/platform/organizations/:id', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(getHandler(org.organizationId), {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns 404 for an unknown org id', async () => {
    admin = await withPlatformAdmin();
    const { status } = await callRoute(getHandler('00000000-0000-0000-0000-000000000000'), {
      method: 'GET',
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(404);
  });

  it('returns the org detail + member roster for a platform admin', async () => {
    [admin, org] = await Promise.all([withPlatformAdmin(), withTestOrg()]);
    const { status, body } = await callRoute<{ organization: PlatformOrgDetail }>(
      getHandler(org.organizationId),
      { method: 'GET', headers: bearerHeader(admin.accessToken) },
    );
    expect(status).toBe(200);
    expect(body.organization.id).toBe(org.organizationId);
    expect(body.organization.member_counts.total).toBe(3);
    expect(body.organization.members).toHaveLength(3);
    const emails = body.organization.members.map((m) => m.email);
    expect(emails).toContain(org.admin.email);
    expect(body.organization.counts.appointments).toBe(0);
  });
});

describe('DELETE /api/platform/organizations/:id', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;
  let other: TestOrgFixture | null = null;

  afterEach(async () => {
    // Most tests delete `org` themselves; cleanup is a no-op if the org row
    // is already gone, but the auth-user deletes still need to run.
    await Promise.all([admin?.cleanup(), org?.cleanup(), other?.cleanup()]);
    admin = null;
    org = null;
    other = null;
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(deleteHandler(org.organizationId), {
      method: 'DELETE',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns 404 for an unknown org id', async () => {
    admin = await withPlatformAdmin();
    const { status } = await callRoute(deleteHandler('00000000-0000-0000-0000-000000000000'), {
      method: 'DELETE',
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(404);
  });

  it('deletes the org + its blocking-FK rows + orphan users, and writes an audit entry', async () => {
    [admin, org] = await Promise.all([withPlatformAdmin(), withTestOrg()]);
    const db = createTestSupabaseClient();

    // Seed rows in every blocking-FK table so we can prove the cascade ran.
    await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
    });

    const orgId = org.organizationId;
    const adminUserId = org.admin.userId;
    const cleanerUserId = org.cleaner.userId;
    const homeownerUserId = org.homeowner.userId;

    const { status, body } = await callRoute<{ success: boolean; counts?: Record<string, number> }>(
      deleteHandler(orgId),
      { method: 'DELETE', headers: bearerHeader(admin.accessToken) },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Org gone.
    const { data: stillOrg } = await db.from('organizations').select('id').eq('id', orgId).maybeSingle();
    expect(stillOrg).toBeNull();

    // Members gone (CASCADE on organization_members → organizations).
    const { data: stillMembers } = await db
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId);
    expect(stillMembers ?? []).toHaveLength(0);

    // Blocking-FK rows gone.
    for (const table of ['appointments', 'properties', 'service_types', 'cleaner_profiles'] as const) {
      const { data } = await db.from(table).select('id').eq('organization_id', orgId);
      expect(data ?? []).toHaveLength(0);
    }

    // Orphan users (admin, cleaner, homeowner — all belonged only to this org) auth-deleted.
    for (const id of [adminUserId, cleanerUserId, homeownerUserId]) {
      const { data: profile } = await db.from('user_profiles').select('id').eq('id', id).maybeSingle();
      expect(profile).toBeNull();
      const { data: authUser } = await db.auth.admin.getUserById(id);
      expect(authUser.user).toBeNull();
    }

    // Audit row written with action='delete_tenant'.
    const { data: auditRows } = await db
      .from('platform_audit_log')
      .select('action, metadata, actor_user_id')
      .eq('actor_user_id', admin.userId)
      .eq('action', 'delete_tenant');
    expect(auditRows ?? []).toHaveLength(1);
    const audit = (auditRows ?? [])[0] as { metadata: Record<string, unknown> };
    expect(audit.metadata).toMatchObject({ org_id: orgId });

    // Mark org as already-cleaned to keep afterEach idempotent.
    org = null;
  });

  it('preserves a user that belongs to another org and never deletes platform admins', async () => {
    [admin, org, other] = await Promise.all([
      withPlatformAdmin(),
      withTestOrg(),
      withTestOrg(),
    ]);
    const db = createTestSupabaseClient();

    // Make `org.admin` also a member of `other` so they should survive.
    await db.from('organization_members').insert({
      user_id: org.admin.userId,
      organization_id: other.organizationId,
      role: 'admin',
    });

    // Also add the platform admin as a member of org — they should never be deleted.
    await db.from('organization_members').insert({
      user_id: admin.userId,
      organization_id: org.organizationId,
      role: 'admin',
    });

    const orgId = org.organizationId;
    const sharedUserId = org.admin.userId;
    const platformAdminId = admin.userId;
    const cleanerUserId = org.cleaner.userId;

    const { status } = await callRoute(deleteHandler(orgId), {
      method: 'DELETE',
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(200);

    // Shared user kept — still has a profile and an auth user.
    const { data: stillProfile } = await db
      .from('user_profiles')
      .select('id')
      .eq('id', sharedUserId)
      .maybeSingle();
    expect(stillProfile).not.toBeNull();
    const { data: stillAuth } = await db.auth.admin.getUserById(sharedUserId);
    expect(stillAuth.user).not.toBeNull();

    // Platform admin kept — never deletable through this flow.
    const { data: stillAdminProfile } = await db
      .from('user_profiles')
      .select('id')
      .eq('id', platformAdminId)
      .maybeSingle();
    expect(stillAdminProfile).not.toBeNull();
    const { data: stillAdminAuth } = await db.auth.admin.getUserById(platformAdminId);
    expect(stillAdminAuth.user).not.toBeNull();

    // Single-org cleaner still deleted.
    const { data: missingCleaner } = await db.auth.admin.getUserById(cleanerUserId);
    expect(missingCleaner.user).toBeNull();

    org = null;
  });
});
