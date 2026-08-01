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
      .select('organization_id, payout_configured_at')
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
      if (cleaner.payout_percent !== undefined) {
        const p = cleaner.payout_percent;
        // Range-checked here, not just in the DB constraint: a constraint
        // violation would fail the whole update with a raw error AFTER the
        // profile fields already wrote.
        if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
          return NextResponse.json(
            { success: false, error: 'payout_percent must be between 0 and 100' },
            { status: 400 },
          );
        }
      }
      for (const k of ['payout_percent', 'hourly_rate', 'experience_years', 'bio'] as const) {
        if (cleaner[k] !== undefined) cleanerUpdate[k] = cleaner[k];
      }
      if (cleaner.payout_model !== undefined) {
        // Accept the pre-118 spelling from stale clients; write the unified one.
        const m =
          cleaner.payout_model === 'percentage_contractor' ? 'percentage' : cleaner.payout_model;
        if (!['percentage', 'flat', 'request', 'hourly_external'].includes(m)) {
          return NextResponse.json(
            { success: false, error: 'payout_model must be percentage, flat, request, or hourly_external' },
            { status: 400 },
          );
        }
        if (m === 'hourly_external') {
          return NextResponse.json(
            { success: false, error: 'That payout model is not yet available' },
            { status: 400 },
          );
        }
        cleanerUpdate.payout_model = m;
      }
      if (cleaner.flat_rate_cents !== undefined) {
        const v = cleaner.flat_rate_cents;
        // Upper bound keeps absurd values a clean 400 instead of an int4
        // overflow 500 from Postgres ($1,000,000 per job is already absurd).
        if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100_000_000)) {
          return NextResponse.json(
            { success: false, error: 'flat_rate_cents must be an integer between 0 and 100000000' },
            { status: 400 },
          );
        }
        cleanerUpdate.flat_rate_cents = v;
      }
      // Saving any pay field IS the pay decision: mark the cleaner configured. An
      // explicit 0% is a deliberate choice and counts; only the absence of a save
      // means unconfigured. Never re-stamped (the first decision's timestamp holds),
      // and never cleared — the unconfigured state exists only before the first save.
      const paySaved = ['payout_model', 'payout_percent', 'flat_rate_cents'].some(
        (k) => cleaner[k] !== undefined,
      );
      const alreadyConfigured =
        (cleanerRow as { payout_configured_at: string | null }).payout_configured_at != null;
      if (paySaved && !alreadyConfigured) {
        cleanerUpdate.payout_configured_at = new Date().toISOString();
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
