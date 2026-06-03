import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgAuth, type RequireOrgAuthResult } from './requireOrgAuth';

/**
 * Authorize a payment-spending action. Like requireOrgAuth, but: owner/admin always pass, and a
 * manager passes ONLY with the `can_manage_payments` fine-grained permission. Used by the org
 * self-pay card routes (and any endpoint that spends the org's own money), mirroring the
 * client-side gate in PaymentsPage / settings.
 */
export async function requireOrgPaymentsAuth(
  request: NextRequest,
  organizationId: string | null | undefined,
  supabaseAdmin: SupabaseClient,
): Promise<RequireOrgAuthResult> {
  const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
    allowedRoles: ['owner', 'admin', 'manager'],
  });
  if (!auth.ok) return auth;

  if (auth.role === 'manager') {
    const { data } = await supabaseAdmin
      .from('manager_permissions')
      .select('can_manage_payments')
      .eq('manager_id', auth.userId)
      .eq('organization_id', organizationId!)
      .maybeSingle();
    if (!(data as { can_manage_payments: boolean } | null)?.can_manage_payments) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Requires the Manage Payments permission' },
          { status: 403 },
        ),
      };
    }
  }
  return auth;
}
