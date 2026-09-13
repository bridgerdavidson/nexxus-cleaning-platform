import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// Unconfigured by default so every pre-existing test keeps the GoTrue
// (inviteUserByEmail) delivery path; the org-branded describe at the bottom
// flips emailConfigured per test to exercise the generateLink + sendEmail path.
vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: vi.fn(async () => undefined),
  emailConfigured: vi.fn(() => false),
}));

// Delegates to the real seat counter, so behavior is unchanged everywhere; the
// fail-open case below overrides it for a single call.
vi.mock('@/lib/billing/seats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/seats')>();
  return { ...actual, countSeatsInUse: vi.fn(actual.countSeatsInUse) };
});

import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { countSeatsInUse } from '@/lib/billing/seats';
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
 * route must create the user itself (generateLink, which sends nothing) and
 * send through the app transport with the org's name as the sender, never
 * GoTrue's mailer. The emailed URL is the accept page, never the consumable
 * action link. When the send fails after the user was created, the invite row
 * must flip to 'failed' exactly like a GoTrue send failure.
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
    // display name and in the subject. The body carries OUR accept page URL,
    // never the consumable GoTrue action link (scanner-prefetch burn, 2026-08-18).
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
    expect(sent.html).toContain(`/accept-invite?invite_id=${body.invite.id}`);
    expect(sent.text).toContain(`/accept-invite?invite_id=${body.invite.id}`);
    expect(sent.html).not.toContain('/auth/v1/verify');
    expect(sent.text).not.toContain(ACTION_LINK);
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

/**
 * Purchased-seat cap (SaaS billing spec §9): seats are bought, not metered, so
 * this route is the only place that asks whether one more cleaner fits. A
 * cleaner member or a PENDING cleaner invite each reserve a seat; a manager,
 * admin, or homeowner invite is never capped; a comped org has no cap at all.
 * The freeze check runs first, so a frozen org sees 402 and not a 409 about
 * seats it cannot buy until it unfreezes.
 */
describe('POST /api/admin/send-invite (purchased seat cap)', () => {
  let org: TestOrgFixture | null = null;
  let owner: OwnerMemberHandle | null = null;
  let manager: ManagerMemberHandle | null = null;

  afterEach(async () => {
    delete process.env.BILLING_ENFORCEMENT_ENABLED;
    vi.restoreAllMocks();
    await Promise.all([owner?.cleanup(), manager?.cleanup()]);
    await org?.cleanup();
    org = null;
    owner = null;
    manager = null;
  });

  interface SeatCapBody {
    success?: boolean;
    error?: string;
    cap?: number | null;
    in_use?: number;
    tier?: string | null;
    next_tier?: string | null;
  }

  /** The GoTrue mailer, mocked exactly as in the describes above. */
  function mockInviteMailer() {
    return vi
      .spyOn(supabaseAdmin.auth.admin, 'inviteUserByEmail')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue({ data: { user: { id: 'usr_mock' } }, error: null } as any);
  }

  /**
   * One invite, from the owner to a fresh address unless overridden. Pass the
   * same `email` twice to model the operator UI's Resend button, which posts
   * here again.
   */
  async function sendInvite(
    role: 'cleaner' | 'manager',
    opts: { accessToken?: string; email?: string } = {},
  ) {
    return callRoute<SeatCapBody>(POST, {
      method: 'POST',
      headers: bearerHeader(opts.accessToken ?? owner!.accessToken),
      body: {
        email: opts.email ?? `seat-${randomUUID().slice(0, 8)}@test.local`,
        role,
        organizationId: org!.organizationId,
      },
    });
  }

  /** A paid Starter subscription with `seats` purchased cleaner seats. */
  async function purchaseSeats(seats: number) {
    const db = createTestSupabaseClient();
    const { error } = await db
      .from('organizations')
      .update({
        comped_at: null,
        subscription_status: 'active',
        plan_tier: 'starter',
        billing_period: 'monthly',
        seat_count: seats,
      })
      .eq('id', org!.organizationId);
    if (error) throw new Error(`failed to set purchased seats: ${error.message}`);
  }

  /** An expired trial, which is the frozen state. */
  async function freezeOrg() {
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({
        comped_at: null,
        subscription_status: 'trialing',
        trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      })
      .eq('id', org!.organizationId);
  }

  it('refuses a cleaner invite at the cap with 409 and the upgrade hint', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    const inviteSpy = mockInviteMailer();
    // The fixture already seeds one cleaner member, so one purchased seat is full.
    await purchaseSeats(1);

    const { status, body } = await sendInvite('cleaner');

    expect(status).toBe(409);
    expect(body).toMatchObject({
      error: 'seat_cap_reached',
      cap: 1,
      in_use: 1,
      tier: 'starter',
      // Starter holds up to 5, so the fix is buying a seat, not a bigger plan.
      next_tier: null,
    });
    // Refused before anything was created: no email, no invite row.
    expect(inviteSpy).not.toHaveBeenCalled();
    const db = createTestSupabaseClient();
    const { data: rows } = await db
      .from('invites')
      .select('id')
      .eq('organization_id', org.organizationId);
    expect(rows ?? []).toEqual([]);
  });

  it('counts a pending invite as a reserved seat', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    mockInviteMailer();
    await purchaseSeats(2);

    // One cleaner member + one pending invite = 2 = the cap.
    const first = await sendInvite('cleaner');
    expect(first.status).toBe(200);

    const second = await sendInvite('cleaner');
    expect(second.status).toBe(409);
    expect(second.body.in_use).toBe(2);
  });

  it('never caps a comped org', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    mockInviteMailer();
    // A comp has a null cap, which means unlimited, never zero.
    const db = createTestSupabaseClient();
    await db
      .from('organizations')
      .update({ comped_at: new Date().toISOString(), seat_count: 1 })
      .eq('id', org.organizationId);

    const { status } = await sendInvite('cleaner');
    expect(status).toBe(200);
  });

  it('does not cap a manager invite', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    mockInviteMailer();
    await purchaseSeats(1);

    const { status } = await sendInvite('manager');
    expect(status).toBe(200);
  });

  it('returns 402 before it considers seats when the org is frozen', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    mockInviteMailer();
    await freezeOrg();

    const { status, body } = await sendInvite('cleaner');
    expect(status).toBe(402);
    expect(body.error).toBe('billing_frozen');
  });

  it('passes through when the flag is off, even past the cap', async () => {
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    mockInviteMailer();
    await purchaseSeats(1);

    const { status } = await sendInvite('cleaner');
    expect(status).toBe(200);
  });

  /**
   * The cap lives after the shared authorization gate, so it applies to every
   * caller who may invite a cleaner, not just owners. Asserted explicitly so a
   * future refactor cannot quietly exempt managers.
   */
  it('caps a manager with can_manage_cleaners too', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    manager = await addManagerToOrg(org.organizationId, { can_manage_cleaners: true });
    const inviteSpy = mockInviteMailer();
    await purchaseSeats(1);

    const { status, body } = await sendInvite('cleaner', { accessToken: manager.accessToken });

    expect(status).toBe(409);
    expect(body.error).toBe('seat_cap_reached');
    expect(inviteSpy).not.toHaveBeenCalled();
  });

  /**
   * Ordering lock: request validation runs BEFORE billing. A malformed request
   * is malformed whatever the org's billing state is, so it must keep answering
   * 400. Without this, flipping BILLING_ENFORCEMENT_ENABLED would turn a bad
   * request's 400 into a 402 in production and nowhere else.
   */
  it('still returns 400 for a missing field while the org is frozen', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    await freezeOrg();

    // Same frozen org, valid body: proof the freeze really is in force here.
    expect((await sendInvite('cleaner')).status).toBe(402);

    const { status, body } = await callRoute<SeatCapBody>(POST, {
      method: 'POST',
      headers: bearerHeader(owner.accessToken),
      body: { role: 'cleaner', organizationId: org.organizationId },
    });

    expect(status).toBe(400);
    expect(body.error).toBe('Missing required fields');
  });

  /**
   * Resend posts to this same route, and the operator UI offers it for any
   * pending invite. The resend supersedes the pending row and promotes a new
   * one, so the pending count is unchanged and no additional seat is consumed.
   * Counting the invite being resent would refuse it at full occupancy and tell
   * the operator to buy a seat for an invite that needs none, which is the
   * steady state for an org that bought exactly what it uses.
   */
  it('does not count the invite being resent, so a resend at full occupancy goes out', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    mockInviteMailer();
    await purchaseSeats(2);

    // One cleaner member + this pending invite = 2 = the cap.
    const email = `resend-${randomUUID().slice(0, 8)}@test.local`;
    expect((await sendInvite('cleaner', { email })).status).toBe(200);

    // The resend itself.
    expect((await sendInvite('cleaner', { email })).status).toBe(200);

    // Still exactly one pending row for that address: it replaced, not added.
    const db = createTestSupabaseClient();
    const { data: pending } = await db
      .from('invites')
      .select('id')
      .eq('organization_id', org.organizationId)
      .eq('email', email)
      .eq('status', 'pending');
    expect((pending ?? []).length).toBe(1);

    // A NEW address at the same occupancy is still refused.
    const { status, body } = await sendInvite('cleaner');
    expect(status).toBe(409);
    expect(body.in_use).toBe(2);
  });

  /**
   * Fail open on a counting error, like assertOrgWritable and the billing-row
   * fetch beside it. The spec already accepts an over-cap race at cap-minus-one,
   * so one extra seat during a database incident is the same trade, while
   * blocking a paying customer's invite is a visible outage. The org here is
   * exactly at its cap, so only the failure can let this invite through.
   */
  it('allows the invite when the seat count cannot be taken', async () => {
    process.env.BILLING_ENFORCEMENT_ENABLED = 'true';
    org = await withTestOrg();
    owner = await addOwnerToOrg(org.organizationId);
    mockInviteMailer();
    await purchaseSeats(1);
    vi.mocked(countSeatsInUse).mockRejectedValueOnce(new Error('connection reset'));

    const { status } = await sendInvite('cleaner');
    expect(status).toBe(200);
  });
});
