import { describe, it, expect, afterEach, vi } from 'vitest';
import { GET, POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { PlatformOrgSummary } from '@/types/platform';

describe('GET /api/platform/organizations', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;

  afterEach(async () => {
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('returns 401 without a token', async () => {
    const { status } = await callRoute(GET, { method: 'GET' });
    expect(status).toBe(401);
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.admin.accessToken),
    });
    expect(status).toBe(403);
  });

  it('returns orgs with member counts for a platform admin', async () => {
    [admin, org] = await Promise.all([withPlatformAdmin(), withTestOrg()]);
    const { status, body } = await callRoute<{ organizations: PlatformOrgSummary[] }>(GET, {
      method: 'GET',
      headers: bearerHeader(admin.accessToken),
    });
    expect(status).toBe(200);
    const mine = body.organizations.find((o) => o.id === org!.organizationId);
    expect(mine).toBeDefined();
    expect(mine!.member_counts.admin).toBe(1);
    expect(mine!.member_counts.cleaner).toBe(1);
    expect(mine!.member_counts.homeowner).toBe(1);
    expect(mine!.member_counts.total).toBe(3);
  });
});

describe('POST /api/platform/organizations (provision tenant)', () => {
  let admin: PlatformAdminFixture | null = null;
  let org: TestOrgFixture | null = null;
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    const db = createTestSupabaseClient();
    // Remove the provision audit rows first (target_org_id is ON DELETE SET NULL,
    // so deleting the org would orphan them rather than clean them up).
    await Promise.all(
      createdOrgIds.map((id) => db.from('platform_audit_log').delete().eq('target_org_id', id)),
    );
    await Promise.all(createdOrgIds.map((id) => db.from('organizations').delete().eq('id', id)));
    createdOrgIds.length = 0;
    await Promise.all([admin?.cleanup(), org?.cleanup()]);
    admin = null;
    org = null;
  });

  it('rejects a normal org admin (403)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.admin.accessToken),
      body: { name: 'Nope Co', owner_email: 'x@y.com' },
    });
    expect(status).toBe(403);
  });

  it('400s on a missing name or bad owner email', async () => {
    admin = await withPlatformAdmin();
    const noName = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(admin.accessToken),
      body: { owner_email: 'founder@acme.com' },
    });
    expect(noName.status).toBe(400);

    const badEmail = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(admin.accessToken),
      body: { name: 'Acme', owner_email: 'not-an-email' },
    });
    expect(badEmail.status).toBe(400);
  });

  it('creates a trialing org + a pending owner invite and emails the founder', async () => {
    admin = await withPlatformAdmin();
    const inviteSpy = vi
      .spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const ownerEmail = `founder-${Date.now()}@acme-test.local`;
    const { status, body } = await callRoute<{
      organization: { id: string };
      invite: { id: string; role: string; status: string };
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(admin.accessToken),
      body: { name: 'Acme Cleaning', owner_email: ownerEmail },
    });

    expect(status).toBe(201);
    const orgId = body.organization.id;
    createdOrgIds.push(orgId);
    expect(body.invite.role).toBe('owner');
    expect(body.invite.status).toBe('pending');

    // The org persisted as trialing.
    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('subscription_status, name')
      .eq('id', orgId)
      .single();
    expect((orgRow as { subscription_status: string }).subscription_status).toBe('trialing');

    // The invite persisted as a pending owner invite for this org.
    const { data: inviteRow } = await db
      .from('invites')
      .select('role, status, email, organization_id')
      .eq('id', body.invite.id)
      .single();
    const inv = inviteRow as { role: string; status: string; email: string; organization_id: string };
    expect(inv.role).toBe('owner');
    expect(inv.status).toBe('pending');
    expect(inv.organization_id).toBe(orgId);
    expect(inv.email).toBe(ownerEmail);

    // The invite email was sent with a redirect that carries this invite id.
    expect(inviteSpy).toHaveBeenCalledTimes(1);
    const [calledEmail, opts] = inviteSpy.mock.calls[0];
    expect(calledEmail).toBe(ownerEmail);
    expect((opts as { redirectTo?: string }).redirectTo).toContain(
      `/accept-invite?invite_id=${body.invite.id}`,
    );

    // The provision was recorded in the platform audit log (surfaced as
    // 'provision_tenant' in the redesign audit view).
    const { data: auditRows } = await db
      .from('platform_audit_log')
      .select('action')
      .eq('target_org_id', orgId)
      .eq('action', 'provision_tenant');
    expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
