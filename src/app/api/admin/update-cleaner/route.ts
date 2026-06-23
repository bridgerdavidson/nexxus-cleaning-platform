import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * Edit a cleaner's profile + payout settings, and soft-bench (deactivate) or
 * reactivate them. Replaces the legacy client-direct writes (which surfaced raw
 * RLS alerts). The org is derived from the cleaner's own profile so a caller
 * can't target a cleaner in another org; the caller is then authorized against
 * THAT org as owner/admin, or a manager holding can_manage_cleaners.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cleanerId, profile, cleaner, deactivated } = body ?? {};
    if (!cleanerId) {
      return NextResponse.json({ success: false, error: 'cleanerId is required' }, { status: 400 });
    }

    const { data: cleanerRow, error: lookupError } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('organization_id')
      .eq('id', cleanerId)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json({ success: false, error: 'Failed to look up cleaner' }, { status: 500 });
    }
    if (!cleanerRow) {
      return NextResponse.json({ success: false, error: 'Cleaner not found' }, { status: 404 });
    }

    const orgId = (cleanerRow as { organization_id: string }).organization_id;
    const auth = await requireOrgAuth(request, orgId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    if (auth.role === 'manager') {
      const { data: perms, error: permsErr } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_manage_cleaners')
        .eq('manager_id', auth.userId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (permsErr) {
        return NextResponse.json({ success: false, error: 'Failed to check manager permissions' }, { status: 500 });
      }
      if (perms?.can_manage_cleaners !== true) {
        return NextResponse.json({ success: false, error: 'Not authorized to manage cleaners' }, { status: 403 });
      }
    }

    // Contact fields live on user_profiles.
    if (profile && typeof profile === 'object') {
      const allowed: Record<string, unknown> = {};
      for (const k of ['first_name', 'last_name', 'email', 'phone'] as const) {
        if (profile[k] !== undefined) allowed[k] = profile[k];
      }
      if (Object.keys(allowed).length > 0) {
        allowed.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin.from('user_profiles').update(allowed).eq('id', cleanerId);
        if (error) {
          return NextResponse.json({ success: false, error: `Failed to update profile: ${error.message}` }, { status: 500 });
        }
      }
    }

    // Cleaner-specific fields + the soft-bench flag live on cleaner_profiles.
    const cleanerUpdate: Record<string, unknown> = {};
    if (cleaner && typeof cleaner === 'object') {
      for (const k of ['payout_percent', 'hourly_rate', 'experience_years', 'bio'] as const) {
        if (cleaner[k] !== undefined) cleanerUpdate[k] = cleaner[k];
      }
    }
    if (deactivated !== undefined) {
      cleanerUpdate.deactivated_at = deactivated ? new Date().toISOString() : null;
    }
    if (Object.keys(cleanerUpdate).length > 0) {
      cleanerUpdate.updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('cleaner_profiles').update(cleanerUpdate).eq('id', cleanerId);
      if (error) {
        return NextResponse.json({ success: false, error: `Failed to update cleaner: ${error.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}
