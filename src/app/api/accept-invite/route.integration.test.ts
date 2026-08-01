import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './route';
import { callRoute } from '../../../../tests/helpers/auth';
import { createAuthUser } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';
import {
  STANDARD_MANAGER_PRESET,
  type ManagerPermissions,
} from '../../../lib/permissions/managerFlags';

/**
 * Sets up a fresh invitee (auth user + access token) and a pending invite of the
 * given org role, then returns what's needed to call accept-invite. `managerPermissions`
 * carries the invite's `manager_permissions` jsonb (defaults to NULL, matching a
 * legacy/non-manager invite); only meaningful when `role === 'manager'`.
 */
async function seedInvite(
  role: 'owner' | 'cleaner' | 'manager',
  managerPermissions: ManagerPermissions | null = null,
  orgDefaultPayoutModel?: string,
) {
  const db = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);

  const { data: org, error: orgErr } = await db
    .from('organizations')
    .insert({
      name: `Accept Org ${uniq}`,
      ...(orgDefaultPayoutModel ? { default_payout_model: orgDefaultPayoutModel } : {}),
    })
    .select('id')
    .single();
  if (orgErr || !org) throw new Error(`seed org failed: ${orgErr?.message ?? 'no data'}`);
  const organizationId = (org as { id: string }).id;

  const email = `invitee-${uniq}@test.local`;
  const invitee = await createAuthUser(email, 'homeowner', 'Invitee');

  // invites.invited_by is a FK to user_profiles(id) (NOT auth.users), and local
  // Supabase has no auth->profile trigger — insert the invitee's profile so the
  // self-referenced invited_by resolves. accept-invite later upserts it.
  const { error: profileErr } = await db.from('user_profiles').upsert(
    { id: invitee.id, email, first_name: 'Invitee', last_name: 'Test', role: 'homeowner' },
    { onConflict: 'id' },
  );
  if (profileErr) throw new Error(`seed profile failed: ${profileErr.message}`);

  const { data: invite, error: inviteErr } = await db
    .from('invites')
    .insert({
      organization_id: organizationId,
      email,
      role,
      status: 'pending',
      accepted_at: null,
      invited_by: invitee.id, // FK -> user_profiles(id), satisfied by the upsert above
      manager_permissions: managerPermissions,
    })
    .select('id')
    .single();
  if (inviteErr || !invite) throw new Error(`seed invite failed: ${inviteErr?.message ?? 'no data'}`);

  return {
    organizationId,
    email,
    inviteId: (invite as { id: string }).id,
    accessToken: invitee.accessToken,
    userId: invitee.id,
    async cleanup() {
      await db.from('organizations').delete().eq('id', organizationId);
      await db.auth.admin.deleteUser(invitee.id);
    },
  };
}

describe('POST /api/accept-invite (owner role mapping)', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  it('owner invite -> OrgRole owner + UserRole admin', async () => {
    const seed = await seedInvite('owner');
    cleanup = seed.cleanup;

    const { status, body } = await callRoute<{ success: boolean; role: string }>(POST, {
      method: 'POST',
      body: {
        accessToken: seed.accessToken,
        inviteId: seed.inviteId,
        firstName: 'Olive',
        lastName: 'Owner',
        password: 'OwnerPass123!',
      },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Returned role drives dashboard routing -> admin dashboard.
    expect(body.role).toBe('admin');

    const db = createTestSupabaseClient();
    const { data: membership } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', seed.organizationId)
      .eq('user_id', seed.userId)
      .single();
    expect((membership as { role: string }).role).toBe('owner');

    const { data: profile } = await db
      .from('user_profiles')
      .select('role')
      .eq('id', seed.userId)
      .single();
    expect((profile as { role: string }).role).toBe('admin');
  });

  it('cleaner invite is unchanged (OrgRole + UserRole both cleaner, profile created)', async () => {
    const seed = await seedInvite('cleaner');
    cleanup = seed.cleanup;

    const { status, body } = await callRoute<{ success: boolean; role: string }>(POST, {
      method: 'POST',
      body: {
        accessToken: seed.accessToken,
        inviteId: seed.inviteId,
        firstName: 'Cleo',
        lastName: 'Cleaner',
        password: 'CleanerPass123!',
      },
    });

    expect(status).toBe(200);
    expect(body.role).toBe('cleaner');

    const db = createTestSupabaseClient();
    const { data: membership } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', seed.organizationId)
      .eq('user_id', seed.userId)
      .single();
    expect((membership as { role: string }).role).toBe('cleaner');

    const { data: profile } = await db
      .from('user_profiles')
      .select('role')
      .eq('id', seed.userId)
      .single();
    expect((profile as { role: string }).role).toBe('cleaner');

    const { data: cleanerProfile } = await db
      .from('cleaner_profiles')
      .select('id')
      .eq('id', seed.userId)
      .maybeSingle();
    expect(cleanerProfile).not.toBeNull();
  });

  it("stamps the org's default payout model onto the new cleaner profile", async () => {
    const seed = await seedInvite('cleaner', null, 'request');
    cleanup = seed.cleanup;

    const { status } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      body: {
        accessToken: seed.accessToken,
        inviteId: seed.inviteId,
        firstName: 'Rita',
        lastName: 'Requests',
        password: 'CleanerPass123!',
      },
    });
    expect(status).toBe(200);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('cleaner_profiles')
      .select('payout_model')
      .eq('id', seed.userId)
      .single();
    expect((data as { payout_model: string }).payout_model).toBe('request');
  });

  it("normalizes a legacy 'percentage_contractor' org default to 'percentage' when stamping", async () => {
    const seed = await seedInvite('cleaner', null, 'percentage_contractor');
    cleanup = seed.cleanup;

    const { status } = await callRoute<{ success: boolean }>(POST, {
      method: 'POST',
      body: {
        accessToken: seed.accessToken,
        inviteId: seed.inviteId,
        firstName: 'Perry',
        lastName: 'Percent',
        password: 'CleanerPass123!',
      },
    });
    expect(status).toBe(200);

    const db = createTestSupabaseClient();
    const { data } = await db
      .from('cleaner_profiles')
      .select('payout_model')
      .eq('id', seed.userId)
      .single();
    expect((data as { payout_model: string }).payout_model).toBe('percentage');
  });
});

/**
 * Invite-carried permissions (manager permission model overhaul, task 7): accepting a
 * manager invite must seed `manager_permissions` from the invite's chosen set when
 * present, and fall back to STANDARD_MANAGER_PRESET (NOT all-true) when the invite's
 * `manager_permissions` is NULL (legacy/no explicit choice). This replaces the old
 * hardcoded seed that set 13 of 14 flags true and omitted `can_handle_requests`.
 */
describe('POST /api/accept-invite (manager permissions seeding)', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  it('seeds manager_permissions from the invite-chosen set when present', async () => {
    const chosen = { ...STANDARD_MANAGER_PRESET, can_manage_payments: true, can_view_bookings: false };
    const seed = await seedInvite('manager', chosen);
    cleanup = seed.cleanup;

    const { status, body } = await callRoute<{ success: boolean; role: string }>(POST, {
      method: 'POST',
      body: {
        accessToken: seed.accessToken,
        inviteId: seed.inviteId,
        firstName: 'Mara',
        lastName: 'Manager',
        password: 'ManagerPass123!',
      },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.role).toBe('manager');

    const db = createTestSupabaseClient();
    const { data: perms } = await db
      .from('manager_permissions')
      .select('*')
      .eq('organization_id', seed.organizationId)
      .eq('manager_id', seed.userId)
      .single();

    for (const key of Object.keys(chosen) as (keyof ManagerPermissions)[]) {
      expect((perms as Record<string, boolean>)[key]).toBe(chosen[key]);
    }
  });

  it('falls back to STANDARD_MANAGER_PRESET (not all-true) when the invite has no chosen permissions', async () => {
    const seed = await seedInvite('manager', null);
    cleanup = seed.cleanup;

    const { status, body } = await callRoute<{ success: boolean; role: string }>(POST, {
      method: 'POST',
      body: {
        accessToken: seed.accessToken,
        inviteId: seed.inviteId,
        firstName: 'Presetta',
        lastName: 'Manager',
        password: 'ManagerPass123!',
      },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const db = createTestSupabaseClient();
    const { data: perms } = await db
      .from('manager_permissions')
      .select('*')
      .eq('organization_id', seed.organizationId)
      .eq('manager_id', seed.userId)
      .single();
    const row = perms as Record<string, boolean>;

    for (const key of Object.keys(STANDARD_MANAGER_PRESET) as (keyof ManagerPermissions)[]) {
      expect(row[key]).toBe(STANDARD_MANAGER_PRESET[key]);
    }
    // Explicitly assert the two flags called out by the brief.
    expect(row.can_handle_requests).toBe(true);
    expect(row.can_manage_payments).toBe(false);
    // Importantly, NOT the old all-true seed: at least one flag must be off.
    expect(Object.values(row).some((v) => v === false)).toBe(true);
  });
});
