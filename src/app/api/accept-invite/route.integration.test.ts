import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { POST } from './route';
import { callRoute } from '../../../../tests/helpers/auth';
import { createAuthUser } from '../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase';

/**
 * Sets up a fresh invitee (auth user + access token) and a pending invite of the
 * given org role, then returns what's needed to call accept-invite.
 */
async function seedInvite(role: 'owner' | 'cleaner') {
  const db = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);

  const { data: org, error: orgErr } = await db
    .from('organizations')
    .insert({ name: `Accept Org ${uniq}` })
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
});
