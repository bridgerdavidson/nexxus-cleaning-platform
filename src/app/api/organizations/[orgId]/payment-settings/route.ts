import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/payment-settings
 *
 * Owner/admin updates the org's cancellation/no-show policy (decision #10). Auth-first:
 * the bearer + org membership are checked before the body is validated. `platform_fee_bps`
 * is intentionally NOT settable here — it's a platform (Nexxus) control, surfaced read-only
 * to tenants (security checklist).
 *
 * Body (all optional; at least one required): { cancellation_window_hours, cancellation_fee_type,
 * cancellation_fee_value }.
 */
const FEE_TYPES = ['none', 'flat', 'percent'] as const;
type FeeType = (typeof FEE_TYPES)[number];

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

    const body = await request.json().catch(() => ({}));
    const { cancellation_window_hours, cancellation_fee_type, cancellation_fee_value } = body as {
      cancellation_window_hours?: number;
      cancellation_fee_type?: string;
      cancellation_fee_value?: number;
    };

    const update: Record<string, unknown> = {};

    if (cancellation_fee_type !== undefined) {
      if (!FEE_TYPES.includes(cancellation_fee_type as FeeType)) {
        return NextResponse.json(
          { error: 'cancellation_fee_type must be one of none, flat, percent' },
          { status: 400 },
        );
      }
      update.cancellation_fee_type = cancellation_fee_type;
    }

    if (cancellation_window_hours !== undefined) {
      const h = Number(cancellation_window_hours);
      if (!Number.isFinite(h) || h < 0 || h > 720) {
        return NextResponse.json(
          { error: 'cancellation_window_hours must be between 0 and 720' },
          { status: 400 },
        );
      }
      update.cancellation_window_hours = Math.round(h);
    }

    if (cancellation_fee_value !== undefined) {
      const v = Number(cancellation_fee_value);
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: 'cancellation_fee_value must be >= 0' }, { status: 400 });
      }
      // A percent fee can't exceed 100% of the job.
      if ((cancellation_fee_type ?? '') === 'percent' && v > 100) {
        return NextResponse.json({ error: 'a percent fee cannot exceed 100' }, { status: 400 });
      }
      update.cancellation_fee_value = v;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('organizations').update(update).eq('id', orgId);
    if (error) {
      return NextResponse.json(
        { error: 'Failed to update payment settings', details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, ...update });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
