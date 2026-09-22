import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyAccessToken } from './verifyToken';
import { assertOrgWritable } from '@/lib/billing/guard';

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
  /**
   * When true, a frozen organization gets 402 after the membership and role
   * checks pass. Ordered last on purpose: an outsider still gets 403, so the
   * response never leaks whether an org they do not belong to is paying.
   * No-op while BILLING_ENFORCEMENT_ENABLED is off.
   */
  requireWritable?: boolean;
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

  const verified = await verifyAccessToken(supabaseAdmin, token);
  if (!verified) {
    return { ok: false, response: json(401, { error: 'Invalid or expired token' }) };
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('user_id', verified.userId)
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

  // Billing runs LAST, after membership and role. A non-member must still get
  // 403, never a 402 that would tell an outsider whether someone else's
  // organization is paying.
  if (options.requireWritable) {
    const writable = await assertOrgWritable(supabaseAdmin, organizationId);
    if (!writable.ok) return { ok: false, response: writable.response };
  }

  return { ok: true, userId: verified.userId, email: verified.email, role };
}
