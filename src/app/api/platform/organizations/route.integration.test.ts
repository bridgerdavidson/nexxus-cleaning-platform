import { describe, it, expect, afterEach, vi } from 'vitest';

// Unconfigured by default so the pre-existing tests keep the GoTrue
// (inviteUserByEmail) delivery path; the Nexxus-branded test below flips
// emailConfigured per test to exercise the generateLink + sendEmail path.
vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: vi.fn(async () => undefined),
  emailConfigured: vi.fn(() => false),
}));

import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
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

  it('with SMTP configured, sends the owner-provision email AS NEXXUS (not white-labeled)', async () => {
    admin = await withPlatformAdmin();
    vi.mocked(emailConfigured).mockReturnValue(true);
    const generateSpy = vi
      .spyOn(supabaseAdmin.auth.admin, 'generateLink')
      .mockResolvedValue({
        data: {
          properties: { action_link: 'https://xyz.supabase.co/auth/v1/verify?token=t&type=invite' },
          user: { id: 'usr_mock' },
        },
        error: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    const inviteSpy = vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail');

    const ownerEmail = `founder-${Date.now()}@acme-branded.local`;
    const { status, body } = await callRoute<{
      organization: { id: string };
      invite: { id: string; status: string };
    }>(POST, {
      method: 'POST',
      headers: bearerHeader(admin.accessToken),
      body: { name: 'Acme Cleaning', owner_email: ownerEmail },
    });

    expect(status).toBe(201);
    createdOrgIds.push(body.organization.id);
    expect(body.invite.status).toBe('pending');

    // The user was created via generateLink (no GoTrue send) with the invite redirect.
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const linkArgs = generateSpy.mock.calls[0][0] as {
      type: string;
      email: string;
      options?: { redirectTo?: string };
    };
    expect(linkArgs.type).toBe('invite');
    expect(linkArgs.email).toBe(ownerEmail);
    expect(linkArgs.options?.redirectTo).toContain(`/accept-invite?invite_id=${body.invite.id}`);
    expect(inviteSpy).not.toHaveBeenCalled();

    // Platform voice: sender name is Nexxus, subject grants the owner account.
    // The body carries OUR accept page URL, never the consumable GoTrue action
    // link (scanner-prefetch burn, 2026-08-18).
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    expect(sent.to).toBe(ownerEmail);
    expect(sent.fromName).toBe('Nexxus');
    expect(sent.subject).toBe('Your owner account for Acme Cleaning is ready');
    expect(sent.html).toContain('Welcome, owner.');
    expect(sent.html).toContain(`/accept-invite?invite_id=${body.invite.id}`);
    expect(sent.html).not.toContain('/auth/v1/verify');
  });

  it('marks the invite failed and 500s when the branded send fails', async () => {
    admin = await withPlatformAdmin();
    vi.mocked(emailConfigured).mockReturnValue(true);
    vi.spyOn(supabaseAdmin.auth.admin, 'generateLink').mockResolvedValue({
      data: {
        properties: { action_link: 'https://xyz.supabase.co/auth/v1/verify?token=t&type=invite' },
        user: { id: 'usr_mock' },
      },
      error: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('smtp down'));

    const ownerEmail = `founder-${Date.now()}@acme-fail.local`;
    const { status, body } = await callRoute<{ error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(admin.accessToken),
      body: { name: 'Acme Cleaning', owner_email: ownerEmail },
    });

    expect(status).toBe(500);
    expect(body.error).toContain('invite email failed');

    // The org row exists (provision is not rolled back) and the invite is 'failed'.
    const db = createTestSupabaseClient();
    const { data: inviteRows } = await db
      .from('invites')
      .select('status, organization_id')
      .eq('email', ownerEmail);
    expect(inviteRows).toHaveLength(1);
    const inv = inviteRows![0] as { status: string; organization_id: string };
    expect(inv.status).toBe('failed');
    createdOrgIds.push(inv.organization_id);
  });
});
