import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgAuth, type OrgRole, type RequireOrgAuthResult } from './requireOrgAuth';
import type { ManagerPermissionKey } from '@/lib/permissions/managerFlags';

export interface RequireManagerPermissionOptions {
  /** Roles allowed on the route. Default ['owner','admin','manager']. Non-manager
   *  allowed roles pass WITHOUT the flag; only 'manager' is gated by it. */
  allowedRoles?: OrgRole[];
  errorMessage?: string;
}

/**
 * Authorize a fine-grained manager action. Owner/admin (and any other role listed in
 * allowedRoles) pass; a caller whose OrgRole is 'manager' passes ONLY if the given
 * manager_permissions flag is true. Fails closed. Returns the same RequireOrgAuthResult
 * as requireOrgAuth so callers keep `auth.userId` / `auth.role`.
 */
export async function requireManagerPermission(
  request: NextRequest,
  organizationId: string | null | undefined,
  supabaseAdmin: SupabaseClient,
  flag: ManagerPermissionKey,
  options: RequireManagerPermissionOptions = {},
): Promise<RequireOrgAuthResult> {
  const allowedRoles = options.allowedRoles ?? ['owner', 'admin', 'manager'];
  const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, { allowedRoles });
  if (!auth.ok) return auth;

  if (auth.role === 'manager') {
    const { data } = await supabaseAdmin
      .from('manager_permissions')
      .select(flag)
      .eq('manager_id', auth.userId)
      .eq('organization_id', organizationId!)
      .maybeSingle();
    if (!(data as Record<string, boolean> | null)?.[flag]) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: options.errorMessage ?? `Requires the ${flag} permission` },
          { status: 403 },
        ),
      };
    }
  }
  return auth;
}
