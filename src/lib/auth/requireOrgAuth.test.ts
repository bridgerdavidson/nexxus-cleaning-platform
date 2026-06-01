import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireOrgAuth } from './requireOrgAuth';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://test.local/api/whatever', {
    method: 'POST',
    headers,
  });
}

function makeSupabaseAdmin(opts: {
  getUserResult?: { data: { user: { id: string; email: string } | null }; error: unknown };
  // When provided, the admin exposes auth.getClaims (the preferred path). When
  // omitted, getClaims is absent so verifyAccessToken falls back to getUser —
  // exactly the behavior under a project still on the HS256 symmetric secret.
  getClaimsResult?: { data: { claims: Record<string, unknown> } | null; error: unknown };
  membership?: { role: string } | null;
  membershipError?: unknown;
}): SupabaseClient {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.membership ?? null,
    error: opts.membershipError ?? null,
  });
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });

  const getUser = vi.fn().mockResolvedValue(
    opts.getUserResult ?? { data: { user: { id: 'u1', email: 'u@test.local' } }, error: null },
  );

  const auth: Record<string, unknown> = { getUser };
  if (opts.getClaimsResult) {
    auth.getClaims = vi.fn().mockResolvedValue(opts.getClaimsResult);
  }

  return {
    auth,
    from,
  } as unknown as SupabaseClient;
}

describe('requireOrgAuth', () => {
  it('returns 400 when organizationId is missing', async () => {
    const result = await requireOrgAuth(makeRequest(), '', makeSupabaseAdmin({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const result = await requireOrgAuth(makeRequest(), 'org-1', makeSupabaseAdmin({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('returns 401 when getUser fails', async () => {
    const supabaseAdmin = makeSupabaseAdmin({
      getUserResult: { data: { user: null }, error: new Error('invalid jwt') },
    });
    const result = await requireOrgAuth(
      makeRequest({ Authorization: 'Bearer bad-token' }),
      'org-1',
      supabaseAdmin,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('returns 403 when caller is not a member of the org', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ membership: null });
    const result = await requireOrgAuth(
      makeRequest({ Authorization: 'Bearer good' }),
      'org-1',
      supabaseAdmin,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns 403 when caller has a role outside the allowedRoles list', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ membership: { role: 'cleaner' } });
    const result = await requireOrgAuth(
      makeRequest({ Authorization: 'Bearer good' }),
      'org-1',
      supabaseAdmin,
      { allowedRoles: ['owner', 'admin'] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns ok with userId and role when caller is in an allowed role', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ membership: { role: 'admin' } });
    const result = await requireOrgAuth(
      makeRequest({ Authorization: 'Bearer good' }),
      'org-1',
      supabaseAdmin,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe('u1');
      expect(result.role).toBe('admin');
      expect(result.email).toBe('u@test.local');
    }
  });

  it('verifies via getClaims (no getUser call) when available and valid', async () => {
    const supabaseAdmin = makeSupabaseAdmin({
      getClaimsResult: {
        data: { claims: { sub: 'claims-user', email: 'claims@test.local' } },
        error: null,
      },
      membership: { role: 'admin' },
    });
    const result = await requireOrgAuth(
      makeRequest({ Authorization: 'Bearer good' }),
      'org-1',
      supabaseAdmin,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe('claims-user');
      expect(result.email).toBe('claims@test.local');
    }
    // getUser must NOT be hit when getClaims resolves the token locally.
    expect((supabaseAdmin.auth as unknown as { getUser: ReturnType<typeof vi.fn> }).getUser).not.toHaveBeenCalled();
  });

  it('returns 401 when getClaims reports an auth error', async () => {
    const supabaseAdmin = makeSupabaseAdmin({
      getClaimsResult: { data: null, error: new Error('token is expired') },
      membership: { role: 'admin' },
    });
    const result = await requireOrgAuth(
      makeRequest({ Authorization: 'Bearer expired' }),
      'org-1',
      supabaseAdmin,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('respects custom allowedRoles list (cleaner allowed)', async () => {
    const supabaseAdmin = makeSupabaseAdmin({ membership: { role: 'cleaner' } });
    const result = await requireOrgAuth(
      makeRequest({ Authorization: 'Bearer good' }),
      'org-1',
      supabaseAdmin,
      { allowedRoles: ['cleaner'] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('cleaner');
  });
});
