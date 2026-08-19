import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { POST } from './route';
import { callRoute } from '../../../../../tests/helpers/auth';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

type ClaimBody = {
  success?: boolean;
  status?: string;
  message?: string;
  tokenHash?: string;
  verificationType?: 'invite' | 'magiclink';
};

/** Fresh anon client per verify: verifyOtp holds the session in memory, so a
 * shared/memoized client would leak auth state between assertions. */
function freshAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Seed exactly what send-invite leaves behind: an invited auth user (created
 * via admin.generateLink type 'invite', which sends nothing) plus an invites
 * row. The action link that generateLink returns is deliberately discarded,
 * matching production where nothing consumable is ever emailed.
 */
async function seedInvitedUser(opts: { status?: string; expirationDate?: string } = {}) {
  const db = createTestSupabaseClient();
  const uniq = randomUUID().slice(0, 8);

  const { data: org, error: orgErr } = await db
    .from('organizations')
    .insert({ name: `Claim Org ${uniq}` })
    .select('id')
    .single();
  if (orgErr || !org) throw new Error(`seed org failed: ${orgErr?.message ?? 'no data'}`);
  const organizationId = (org as { id: string }).id;

  const email = `claimee-${uniq}@test.local`;
  const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
    type: 'invite',
    email,
  });
  if (linkErr || !linkData?.user) throw new Error(`seed invited user failed: ${linkErr?.message ?? 'no user'}`);
  const userId = linkData.user.id;

  // invites.invited_by is a FK to user_profiles(id); local Supabase has no
  // auth->profile trigger, so insert the profile explicitly.
  const { error: profileErr } = await db.from('user_profiles').upsert(
    { id: userId, email, first_name: 'Claim', last_name: 'Test', role: 'cleaner' },
    { onConflict: 'id' },
  );
  if (profileErr) throw new Error(`seed profile failed: ${profileErr.message}`);

  const { data: invite, error: inviteErr } = await db
    .from('invites')
    .insert({
      organization_id: organizationId,
      email,
      role: 'cleaner',
      status: opts.status ?? 'pending',
      invited_by: userId,
      ...(opts.expirationDate ? { expiration_date: opts.expirationDate } : {}),
    })
    .select('id')
    .single();
  if (inviteErr || !invite) throw new Error(`seed invite failed: ${inviteErr?.message ?? 'no data'}`);

  return {
    inviteId: (invite as { id: string }).id,
    email,
    userId,
    async cleanup() {
      await db.from('organizations').delete().eq('id', organizationId);
      await db.auth.admin.deleteUser(userId);
    },
  };
}

async function claim(inviteId?: unknown) {
  return callRoute<ClaimBody>(POST, {
    method: 'POST',
    body: inviteId === undefined ? {} : { inviteId },
  });
}

describe('POST /api/accept-invite/claim', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  it('400 without an invite id', async () => {
    const { status } = await claim();
    expect(status).toBe(400);
  });

  it('404 for an unknown invite id', async () => {
    const { status, body } = await claim(randomUUID());
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('mints a token for a pending invite that a fresh client can verify into a session', async () => {
    const seed = await seedInvitedUser();
    cleanup = seed.cleanup;

    const { status, body } = await claim(seed.inviteId);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.tokenHash).toBeTruthy();

    const anon = freshAnonClient();
    const { data, error } = await anon.auth.verifyOtp({
      type: body.verificationType ?? 'invite',
      token_hash: body.tokenHash as string,
    });
    expect(error).toBeNull();
    expect(data.session).toBeTruthy();
    expect(data.session?.user.email).toBe(seed.email);
  });

  it('a second claim still works after the first token was verified (abandoned form, re-click)', async () => {
    const seed = await seedInvitedUser();
    cleanup = seed.cleanup;

    const first = await claim(seed.inviteId);
    expect(first.body.success).toBe(true);
    const firstVerify = await freshAnonClient().auth.verifyOtp({
      type: first.body.verificationType ?? 'invite',
      token_hash: first.body.tokenHash as string,
    });
    expect(firstVerify.error).toBeNull();

    // The user is now registered from GoTrue's point of view; the route must
    // fall back to a magiclink token rather than failing the re-invite.
    const second = await claim(seed.inviteId);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    const secondVerify = await freshAnonClient().auth.verifyOtp({
      type: second.body.verificationType ?? 'invite',
      token_hash: second.body.tokenHash as string,
    });
    expect(secondVerify.error).toBeNull();
    expect(secondVerify.data.session?.user.email).toBe(seed.email);
  });

  it('a lapsed expiration_date returns expired and flips the row', async () => {
    const seed = await seedInvitedUser({
      expirationDate: new Date(Date.now() - 60_000).toISOString(),
    });
    cleanup = seed.cleanup;

    const { status, body } = await claim(seed.inviteId);
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.status).toBe('expired');
    expect(body.tokenHash).toBeUndefined();

    const db = createTestSupabaseClient();
    const { data } = await db.from('invites').select('status').eq('id', seed.inviteId).single();
    expect((data as { status: string }).status).toBe('expired');
  });

  it('a superseded invite is refused without minting anything', async () => {
    const seed = await seedInvitedUser({ status: 'superseded' });
    cleanup = seed.cleanup;

    const { status, body } = await claim(seed.inviteId);
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.status).toBe('invalid');
    expect(body.tokenHash).toBeUndefined();
    expect(body.message).toMatch(/newer invite/i);
  });
});
