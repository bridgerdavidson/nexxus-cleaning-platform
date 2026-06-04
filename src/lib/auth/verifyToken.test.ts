import { describe, it, expect, vi } from 'vitest';
import { verifyAccessToken } from './verifyToken';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Builds a fake supabase admin client whose auth surface can be configured per case.
 * When `getClaimsResult` is provided the client exposes auth.getClaims (the preferred,
 * local-verification path on asymmetric signing keys). When omitted, getClaims is absent
 * so verifyAccessToken falls back to getUser — the behavior on the legacy HS256 secret
 * and under test mocks that only stub getUser.
 */
function makeSupabaseAdmin(opts: {
  getClaimsResult?: { data: { claims: Record<string, unknown> } | null; error: unknown };
  getClaimsThrows?: boolean;
  getUserResult?: { data: { user: { id: string; email: string | null } | null }; error: unknown };
}): { client: SupabaseClient; getUser: ReturnType<typeof vi.fn>; getClaims?: ReturnType<typeof vi.fn> } {
  const getUser = vi.fn().mockResolvedValue(
    opts.getUserResult ?? { data: { user: { id: 'getuser-id', email: 'getuser@test.local' } }, error: null },
  );

  const auth: Record<string, unknown> = { getUser };
  let getClaims: ReturnType<typeof vi.fn> | undefined;
  if (opts.getClaimsThrows) {
    getClaims = vi.fn().mockRejectedValue(new Error('jwks fetch failed'));
    auth.getClaims = getClaims;
  } else if (opts.getClaimsResult) {
    getClaims = vi.fn().mockResolvedValue(opts.getClaimsResult);
    auth.getClaims = getClaims;
  }

  return { client: { auth } as unknown as SupabaseClient, getUser, getClaims };
}

describe('verifyAccessToken', () => {
  it('verifies locally via getClaims and does NOT call getUser', async () => {
    const { client, getUser } = makeSupabaseAdmin({
      getClaimsResult: { data: { claims: { sub: 'claims-id', email: 'claims@test.local' } }, error: null },
    });
    const result = await verifyAccessToken(client, 'tok');
    expect(result).toEqual({ userId: 'claims-id', email: 'claims@test.local' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns email null when the claims carry no email', async () => {
    const { client } = makeSupabaseAdmin({
      getClaimsResult: { data: { claims: { sub: 'claims-id' } }, error: null },
    });
    expect(await verifyAccessToken(client, 'tok')).toEqual({ userId: 'claims-id', email: null });
  });

  it('returns null (no getUser fallback) when getClaims reports an auth error', async () => {
    const { client, getUser } = makeSupabaseAdmin({
      getClaimsResult: { data: null, error: new Error('token is expired') },
    });
    expect(await verifyAccessToken(client, 'expired')).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('falls back to getUser when getClaims is absent (legacy HS256 secret)', async () => {
    const { client, getUser } = makeSupabaseAdmin({
      getUserResult: { data: { user: { id: 'getuser-id', email: 'getuser@test.local' } }, error: null },
    });
    const result = await verifyAccessToken(client, 'tok');
    expect(result).toEqual({ userId: 'getuser-id', email: 'getuser@test.local' });
    expect(getUser).toHaveBeenCalledOnce();
  });

  it('falls back to getUser when getClaims throws', async () => {
    const { client, getUser } = makeSupabaseAdmin({
      getClaimsThrows: true,
      getUserResult: { data: { user: { id: 'getuser-id', email: 'getuser@test.local' } }, error: null },
    });
    const result = await verifyAccessToken(client, 'tok');
    expect(result).toEqual({ userId: 'getuser-id', email: 'getuser@test.local' });
    expect(getUser).toHaveBeenCalledOnce();
  });

  it('falls back to getUser when getClaims verifies but yields no subject', async () => {
    const { client, getUser } = makeSupabaseAdmin({
      getClaimsResult: { data: { claims: { email: 'no-sub@test.local' } }, error: null },
      getUserResult: { data: { user: { id: 'getuser-id', email: 'getuser@test.local' } }, error: null },
    });
    expect(await verifyAccessToken(client, 'tok')).toEqual({ userId: 'getuser-id', email: 'getuser@test.local' });
    expect(getUser).toHaveBeenCalledOnce();
  });

  it('returns null when both getClaims is absent and getUser fails', async () => {
    const { client } = makeSupabaseAdmin({
      getUserResult: { data: { user: null }, error: new Error('invalid jwt') },
    });
    expect(await verifyAccessToken(client, 'bad')).toBeNull();
  });
});
