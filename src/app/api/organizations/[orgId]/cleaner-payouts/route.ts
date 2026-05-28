import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/cleaner-payouts
 *
 * Owner/admin sets the org-wide default payout % (applied at cleaner-create
 * time). Per-cleaner overrides on `cleaner_profiles.payout_percent` are edited
 * through the existing `bulk_update_cleaner_payouts` RPC.
 *
 * Body: { default_cleaner_payout_percent: number 0..100 }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await params;

    const auth = await requireOrgAuth(request, orgId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      default_cleaner_payout_percent?: number;
    };

    if (body.default_cleaner_payout_percent === undefined) {
      return NextResponse.json({ error: 'default_cleaner_payout_percent is required' }, { status: 400 });
    }

    const v = Number(body.default_cleaner_payout_percent);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return NextResponse.json(
        { error: 'default_cleaner_payout_percent must be between 0 and 100' },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ default_cleaner_payout_percent: v })
      .eq('id', orgId);
    if (error) {
      return NextResponse.json(
        { error: 'Failed to update default cleaner payout', details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, default_cleaner_payout_percent: v });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
