import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// Unconfigured by default so every pre-existing test keeps the GoTrue
// (inviteUserByEmail) delivery path; the org-branded describe at the bottom
// flips emailConfigured per test to exercise the generateLink + sendEmail path.
vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: vi.fn(async () => undefined),
  emailConfigured: vi.fn(() => false),
}));

import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import {
  withTestOrg,
  addOwnerToOrg,
  addManagerToOrg,
  withPlatformAdmin,
  type TestOrgFixture,
  type OwnerMemberHandle,
  type ManagerMemberHandle,
  type PlatformAdminFixture,
} from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { STANDARD_MANAGER_PRESET } from '@/lib/permissions/managerFlags';

/**
 * Regression: an org OWNER (organization_members.role = 'owner') must be able to
 * send invites. The route gated on role === 'admin', which excluded owners and
 * produced the "Not authorized to send invites" 401 the founder hit when
 * inviting their first cleaner. The Supabase invite email is mocked so the test
 * is deterministic and leaves no stray auth users.
 */
describe('POST /api/admin/send-invite (owner authorization)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await owner?.cleanup();
    await org?.cleanup();
    owner = null;
    org = null;
  });

  it('401 without a token', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(POST, {
      method: 'POST',
      body: { email: 'x@y.local', role: 'cleaner', organizationId: org.organizationId },
    });
    expect(status).toBe(401);
  });

  it('lets an org owner send a cleaner invite (200)', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);

    const inviteSpy = vi
      .spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const email = `newhire-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean; invite: { status: string } }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: { email, role: 'cleaner', organizationId: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invite.status).toBe('pending');
    expect(inviteSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a cleaner trying to send invites (401)', async () => {
    org = await withTestOrg();
    const { status } = await callRoute(POST, {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { email: 'someone@test.local', role: 'cleaner', organizationId: org.organizationId },
    });
    expect(status).toBe(401);
  });
});

/**
 * Regression for "Failed to clear stale auth user: Database error deleting user":
 * inviting an email that belongs to a REAL account (a platform admin, or a member
 * of another org) used to fall through to the "stale invitee" cleanup and try to
 * DELETE that live user. It must instead be blocked, and the account left intact.
 */
describe('POST /api/admin/send-invite (never deletes a real account)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;
  let platformAdmin: PlatformAdminFixture | null = null;
  let otherOrg: TestOrgFixture | null = null;

  afterEach(async () => {
    await owner?.cleanup();
    await Promise.all([platformAdmin?.cleanup(), otherOrg?.cleanup(), org?.cleanup()]);
    org = null;
    owner = null;
    platformAdmin = null;
    otherOrg = null;
  });

  it("refuses to invite a platform admin's email and does NOT delete them", async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    platformAdmin = await withPlatformAdmin();

    const { status, body } = await callRoute<{ error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { email: platformAdmin.email, role: 'cleaner', organizationId: org.organizationId },
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/already belongs to a Nexxus account/i);

    // The live account must still exist — the bug tried to delete it.
    const db = createTestSupabaseClient();
    const { data } = await db
      .from('user_profiles')
      .select('id')
      .eq('id', platformAdmin.userId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });

  it('refuses to invite an email that is active in another org', async () => {
    [org, otherOrg] = await Promise.all([withTestOrg(), withTestOrg()]);
    owner = await addOwnerToOrg(org.organizationId);

    const { status, body } = await callRoute<{ error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { email: otherOrg.cleaner.email, role: 'cleaner', organizationId: org.organizationId },
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/already belongs to a Nexxus account/i);

    // Still a member of the other org.
    const db = createTestSupabaseClient();
    const { data } = await db
      .from('organization_members')
      .select('user_id')
      .eq('user_id', otherOrg.cleaner.userId)
      .eq('organization_id', otherOrg.organizationId)
      .maybeSingle();
    expect(data).not.toBeNull();
  });
});

/**
 * Role ceiling (security audit H4): a manager authorized via can_manage_cleaners may
 * invite cleaners only — never a manager or admin, which would let them mint a
 * peer/superior who could then revoke them.
 */
describe('POST /api/admin/send-invite (role ceiling)', () => {
  let org: TestOrgFixture | null = null;
  let manager: ManagerMemberHandle | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await manager?.cleanup();
    await org?.cleanup();
    manager = null;
    org = null;
  });

  it('rejects a manager inviting an admin (403)', async () => {
    org = await withTestOrg();
    manager = await addManagerToOrg(org.organizationId, { can_manage_cleaners: true });

    const inviteSpy = vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail');

    const { status, body } = await callRoute<{ success: boolean; error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(manager.accessToken),
      body: { email: `esc-${randomUUID().slice(0, 8)}@test.local`, role: 'admin', organizationId: org.organizationId },
    });

    expect(status).toBe(403);
    expect(body.error).toMatch(/managers can only invite cleaners/i);
    // No invite email should have been attempted.
    expect(inviteSpy).not.toHaveBeenCalled();
  });

  it('lets a manager invite a cleaner (200)', async () => {
    org = await withTestOrg();
    manager = await addManagerToOrg(org.organizationId, { can_manage_cleaners: true });

    vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(manager.accessToken),
      body: { email: `hire-${randomUUID().slice(0, 8)}@test.local`, role: 'cleaner', organizationId: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

/**
 * Homeowner invites reuse the team-invite flow with role 'homeowner' (the
 * "Send sign up link" button on the Add Customer modal). Owners/admins may send
 * them; a manager needs can_edit_customers — NOT can_manage_cleaners — which
 * mirrors when the "New customer" button is shown to managers.
 */
describe('POST /api/admin/send-invite (homeowner role)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;
  let manager: ManagerMemberHandle | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([owner?.cleanup(), manager?.cleanup()]);
    await org?.cleanup();
    org = null;
    owner = null;
    manager = null;
  });

  it('lets an org owner send a homeowner invite (200)', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);

    vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const email = `homeowner-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean; invite: { status: string } }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: { email, role: 'homeowner', organizationId: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.invite.status).toBe('pending');
  });

  it('lets a manager with can_edit_customers send a homeowner invite (200)', async () => {
    org = await withTestOrg();
    manager = await addManagerToOrg(org.organizationId, { can_edit_customers: true });

    vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const email = `homeowner-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      headers: bearerHeader(manager.accessToken),
      body: { email, role: 'homeowner', organizationId: org.organizationId },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('rejects a manager without can_edit_customers from inviting a homeowner (403)', async () => {
    org = await withTestOrg();
    // Has can_manage_cleaners (so they're authorized to send *some* invite) but
    // NOT can_edit_customers, so the homeowner role must be refused by the ceiling.
    manager = await addManagerToOrg(org.organizationId, { can_manage_cleaners: true });

    const inviteSpy = vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail');

    const { status, body } = await callRoute<{ success: boolean; error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(manager.accessToken),
      body: {
        email: `homeowner-${randomUUID().slice(0, 8)}@test.local`,
        role: 'homeowner',
        organizationId: org.organizationId,
      },
    });

    expect(status).toBe(403);
    expect(body.error).toMatch(/managers can only invite cleaners or homeowners/i);
    expect(inviteSpy).not.toHaveBeenCalled();
  });
});

/**
 * Invite-carried permissions (manager permission model overhaul, task 7): a manager
 * invite's chosen `permissions` must be sanitized and persisted on the invite row as
 * `manager_permissions` jsonb, so accept-invite can seed exactly that set later
 * instead of the old hardcoded all-true seed. Non-manager invites must store NULL.
 */
describe('POST /api/admin/send-invite (invite-carried manager permissions)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await owner?.cleanup();
    await org?.cleanup();
    owner = null;
    org = null;
  });

  it('stores the chosen permissions jsonb on a manager invite', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);

    vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const email = `mgr-${randomUUID().slice(0, 8)}@test.local`;
    const chosenPermissions = { ...STANDARD_MANAGER_PRESET, can_manage_payments: true };
    const { status, body } = await callRoute<{ success: boolean; invite: { id: string } }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: {
          email,
          role: 'manager',
          organizationId: org.organizationId,
          permissions: chosenPermissions,
        },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: invite } = await db
      .from('invites')
      .select('manager_permissions')
      .eq('id', body.invite.id)
      .single();
    const stored = (invite as { manager_permissions: Record<string, boolean> }).manager_permissions;
    expect(stored.can_manage_payments).toBe(true);
    expect(stored.can_view_bookings).toBe(true);
  });

  it('stores manager_permissions = null for a non-manager invite', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);

    vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const email = `cln-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean; invite: { id: string } }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: { email, role: 'cleaner', organizationId: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: invite } = await db
      .from('invites')
      .select('manager_permissions')
      .eq('id', body.invite.id)
      .single();
    expect((invite as { manager_permissions: unknown }).manager_permissions).toBeNull();
  });

  /**
   * Regression: no current UI caller passes `permissions` on a manager invite (the
   * invite-time editor is a future task). Before the fix, the route unconditionally
   * called coerceManagerPermissions(permissions), which for `undefined` returns an
   * ALL-FALSE 14-key object (not null) — a truthy value that accept-invite's
   * `invite.manager_permissions ? coerce(...) : STANDARD_MANAGER_PRESET` then reads
   * as "explicit permissions", seeding the manager with ZERO permissions instead of
   * falling back to the preset. A manager invite with no `permissions` field must
   * store NULL so accept-invite reaches the preset fallback.
   */
  it('stores manager_permissions = null for a manager invite with no permissions chosen', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);

    vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);

    const email = `mgr-nopermissions-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean; invite: { id: string } }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: { email, role: 'manager', organizationId: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: invite } = await db
      .from('invites')
      .select('manager_permissions')
      .eq('id', body.invite.id)
      .single();
    expect((invite as { manager_permissions: unknown }).manager_permissions).toBeNull();
  });
});

/**
 * Org-branded invite delivery (white-label sender): when SMTP is configured the
 * route must mint the action link itself (generateLink) and send through the
 * app transport with the org's name as the sender, never GoTrue's mailer. When
 * the send fails after the link was minted, the invite row must flip to
 * 'failed' exactly like a GoTrue send failure.
 */
describe('POST /api/admin/send-invite (org-branded delivery)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;

  const ACTION_LINK =
    'http://127.0.0.1:54321/auth/v1/verify?token=tok123&type=invite&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Faccept-invite%3Finvite_id%3Dabc';

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(emailConfigured).mockReturnValue(false);
    await owner?.cleanup();
    await org?.cleanup();
    org = null;
    owner = null;
  });

  it('sends via generateLink + org-named sender and never calls the GoTrue mailer', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    vi.mocked(emailConfigured).mockReturnValue(true);
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const generateLinkSpy = vi
      .spyOn(supabaseAdmin.auth.admin, 'generateLink')
       
      .mockResolvedValue({
        data: { properties: { action_link: ACTION_LINK }, user: { id: 'usr_mock' } },
        error: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    const inviteByEmailSpy = vi.spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail');

    const email = `branded-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean; invite: { id: string; status: string } }>(
      POST,
      {
        method: 'POST',
        headers: bearerHeader(owner.accessToken),
        body: { email, role: 'cleaner', organizationId: org.organizationId },
      },
    );

    expect(status).toBe(200);
    expect(body.invite.status).toBe('pending');
    expect(inviteByEmailSpy).not.toHaveBeenCalled();

    // The minted link targets this invite's accept page.
    expect(generateLinkSpy).toHaveBeenCalledTimes(1);
    const linkArgs = generateLinkSpy.mock.calls[0][0] as {
      type: string;
      email: string;
      options?: { redirectTo?: string };
    };
    expect(linkArgs.type).toBe('invite');
    expect(linkArgs.email).toBe(email);
    expect(linkArgs.options?.redirectTo).toContain(`/accept-invite?invite_id=${body.invite.id}`);

    // The email went out through the branded transport: org name as the sender
    // display name and in the subject, the action link in the body.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(sendEmail).mock.calls[0][0];
    const db = createTestSupabaseClient();
    const { data: orgRow } = await db
      .from('organizations')
      .select('name')
      .eq('id', org.organizationId)
      .single();
    const orgName = (orgRow as { name: string }).name;
    expect(sent.to).toBe(email);
    expect(sent.fromName).toBe(orgName);
    expect(sent.subject).toContain(orgName);
    expect(sent.html).toContain('/auth/v1/verify');
    expect(sent.text).toContain(ACTION_LINK);
  });

  it('marks the invite failed and 500s when the branded send fails after link minting', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    vi.mocked(emailConfigured).mockReturnValue(true);
    vi.mocked(sendEmail).mockRejectedValue(new Error('smtp down'));
    vi.spyOn(supabaseAdmin.auth.admin, 'generateLink')
       
      .mockResolvedValue({
        data: { properties: { action_link: ACTION_LINK }, user: { id: 'usr_mock' } },
        error: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

    const email = `branded-fail-${randomUUID().slice(0, 8)}@test.local`;
    const { status, body } = await callRoute<{ success: boolean; error: string }>(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { email, role: 'cleaner', organizationId: org.organizationId },
    });

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain('smtp down');

    const db = createTestSupabaseClient();
    const { data: rows } = await db
      .from('invites')
      .select('status')
      .eq('email', email)
      .eq('organization_id', org.organizationId);
    expect((rows ?? []).map((r) => (r as { status: string }).status)).toEqual(['failed']);
  });
});
