import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyAccessToken } from './verifyToken';

/**
 * Server-side gate for the platform-owner back-office (/api/platform/*).
 *
 * Mirrors requireOrgAuth, minus the org param: a platform admin is NOT scoped to
 * a single organization — they sit above all tenants. Verifies the Bearer token
 * then checks membership in `platform_admins` (a table only the service role can
 * read; see migration 068). Use the returned `userId` for audit attribution.
 */
export interface RequirePlatformAdminSuccess {
  ok: true;
  userId: string;
  email: string | null;
}

export interface RequirePlatformAdminFailure {
  ok: false;
  response: NextResponse;
}

export type RequirePlatformAdminResult =
  | RequirePlatformAdminSuccess
  | RequirePlatformAdminFailure;

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status });

export async function requirePlatformAdmin(
  request: NextRequest,
  supabaseAdmin: SupabaseClient,
): Promise<RequirePlatformAdminResult> {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { ok: false, response: json(401, { error: 'Missing authorization token' }) };
  }

  const verified = await verifyAccessToken(supabaseAdmin, token);
  if (!verified) {
    return { ok: false, response: json(401, { error: 'Invalid or expired token' }) };
  }

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', verified.userId)
    .maybeSingle();

  if (adminError) {
    return { ok: false, response: json(500, { error: 'Failed to load platform admin status' }) };
  }
  if (!adminRow) {
    return { ok: false, response: json(403, { error: 'Not a platform admin' }) };
  }

  return { ok: true, userId: verified.userId, email: verified.email };
}
