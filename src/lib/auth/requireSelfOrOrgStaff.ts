import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyAccessToken } from './verifyToken';
import { requireOrgAuth } from './requireOrgAuth';
import { homeownerBelongsToOrg } from '@/lib/payments/orgHomeowner';

export interface SelfOrOrgStaffSuccess {
  ok: true;
  userId: string;
  /** True when the caller IS the homeowner (self-service), false for org staff. */
  isSelf: boolean;
}

export interface SelfOrOrgStaffFailure {
  ok: false;
  response: NextResponse;
}

export type SelfOrOrgStaffResult = SelfOrOrgStaffSuccess | SelfOrOrgStaffFailure;

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status });

/**
 * Authorize an action on a homeowner's payment identity (saving cards, attaching
 * Stripe customers). Allowed callers:
 *
 *  1. The homeowner themselves (verified token subject === homeowner_id), or
 *  2. Org staff (owner/admin/manager of `organizationId`) acting on a homeowner
 *     who belongs to that org (member or has booked with it).
 *
 * Staff callers MUST supply `organizationId`; self-service callers don't need to.
 * The hosted card-link flow does not go through here (it is token-scoped separately).
 */
export async function requireSelfOrOrgStaff(
  request: NextRequest,
  supabaseAdmin: SupabaseClient,
  homeownerId: string | null | undefined,
  organizationId: string | null | undefined,
): Promise<SelfOrOrgStaffResult> {
  if (!homeownerId) {
    return { ok: false, response: json(400, { error: 'homeowner_id is required' }) };
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

  if (verified.userId === homeownerId) {
    return { ok: true, userId: verified.userId, isSelf: true };
  }

  // Staff path: must be owner/admin/manager of the org, and the homeowner must be
  // associated with that org (requireOrgAuth 400s when organizationId is absent).
  const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
    allowedRoles: ['owner', 'admin', 'manager'],
  });
  if (!auth.ok) return auth;

  const belongs = await homeownerBelongsToOrg(supabaseAdmin, homeownerId, organizationId!);
  if (!belongs) {
    return { ok: false, response: json(404, { error: 'Homeowner not found' }) };
  }

  return { ok: true, userId: auth.userId, isSelf: false };
}
