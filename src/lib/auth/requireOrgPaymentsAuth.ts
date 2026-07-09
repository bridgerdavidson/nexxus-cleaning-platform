import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequireOrgAuthResult } from './requireOrgAuth';
import { requireManagerPermission } from './requireManagerPermission';

/**
 * Authorize a payment-spending action: owner/admin pass, a manager passes only with
 * `can_manage_payments`. Thin wrapper over requireManagerPermission (kept for its
 * existing call sites and error copy).
 */
export async function requireOrgPaymentsAuth(
  request: NextRequest,
  organizationId: string | null | undefined,
  supabaseAdmin: SupabaseClient,
): Promise<RequireOrgAuthResult> {
  return requireManagerPermission(request, organizationId, supabaseAdmin, 'can_manage_payments', {
    errorMessage: 'Requires the Manage Payments permission',
  });
}
