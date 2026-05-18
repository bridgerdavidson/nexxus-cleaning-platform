import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type OrgRole = 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner';

export interface RequireOrgAuthSuccess {
  ok: true;
  userId: string;
  email: string | null;
  role: OrgRole;
}

export interface RequireOrgAuthFailure {
  ok: false;
  response: NextResponse;
}

export type RequireOrgAuthResult = RequireOrgAuthSuccess | RequireOrgAuthFailure;

export interface RequireOrgAuthOptions {
  /**
   * Roles permitted to perform the action. Caller's `organization_members.role`
   * must be in this list. Default: `['owner', 'admin']`.
   */
  allowedRoles?: OrgRole[];
}

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status });

export async function requireOrgAuth(
  request: NextRequest,
  organizationId: string | null | undefined,
  supabaseAdmin: SupabaseClient,
  options: RequireOrgAuthOptions = {},
): Promise<RequireOrgAuthResult> {
  const allowedRoles = options.allowedRoles ?? ['owner', 'admin'];

  if (!organizationId) {
    return { ok: false, response: json(400, { error: 'organizationId is required' }) };
  }

  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { ok: false, response: json(401, { error: 'Missing authorization token' }) };
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return { ok: false, response: json(401, { error: 'Invalid or expired token' }) };
  }
  const user = userData.user;

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (membershipError) {
    return { ok: false, response: json(500, { error: 'Failed to load membership' }) };
  }
  if (!membership) {
    return { ok: false, response: json(403, { error: 'Not a member of this organization' }) };
  }

  const role = membership.role as OrgRole;
  if (!allowedRoles.includes(role)) {
    return { ok: false, response: json(403, { error: 'Insufficient role for this action' }) };
  }

  return { ok: true, userId: user.id, email: user.email ?? null, role };
}
