import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
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
