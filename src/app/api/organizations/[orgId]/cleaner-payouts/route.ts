import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/cleaner-payouts
 *
 * Owner/admin sets the org-wide payout knobs: the default payout % (applied at
 * cleaner-create time) and the pay-request auto-approve margin (min_margin_bps,
 * the share of the job price the org keeps; requests that leave at least this
 * margin auto-approve). Per-cleaner overrides on `cleaner_profiles.payout_percent`
 * are edited through the existing `bulk_update_cleaner_payouts` RPC.
 *
 * Body (at least one required):
 *   { default_cleaner_payout_percent?: number 0..100, min_margin_bps?: integer 0..10000 }
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
      min_margin_bps?: number;
    };

    if (body.default_cleaner_payout_percent === undefined && body.min_margin_bps === undefined) {
      return NextResponse.json(
        { error: 'default_cleaner_payout_percent or min_margin_bps is required' },
        { status: 400 },
      );
    }

    const update: Record<string, unknown> = { payout_configured_at: new Date().toISOString() };

    if (body.default_cleaner_payout_percent !== undefined) {
      const v = Number(body.default_cleaner_payout_percent);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        return NextResponse.json(
          { error: 'default_cleaner_payout_percent must be between 0 and 100' },
          { status: 400 },
        );
      }
      update.default_cleaner_payout_percent = v;
    }

    if (body.min_margin_bps !== undefined) {
      const bps = Number(body.min_margin_bps);
      // Integer bps only: the auto-approve threshold math (autoApproveMaxCents)
      // rejects fractional bps, so bad data must never reach the column.
      if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
        return NextResponse.json(
          { error: 'min_margin_bps must be an integer between 0 and 10000' },
          { status: 400 },
        );
      }
      update.min_margin_bps = bps;
    }

    const { error } = await supabaseAdmin.from('organizations').update(update).eq('id', orgId);
    if (error) {
      return NextResponse.json(
        { error: 'Failed to update cleaner payout settings', details: error.message },
        { status: 500 },
      );
    }

    const echo: Record<string, unknown> = {};
    if (update.default_cleaner_payout_percent !== undefined)
      echo.default_cleaner_payout_percent = update.default_cleaner_payout_percent;
    if (update.min_margin_bps !== undefined) echo.min_margin_bps = update.min_margin_bps;
    return NextResponse.json({ success: true, ...echo });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
