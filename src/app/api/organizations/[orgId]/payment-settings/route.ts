import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/payment-settings
 *
 * Owner/admin updates the org's three policy groups:
 *   • cancellation  (window + fee)            — decision #10, original scope
 *   • no-show       (fee type + value)        — added 071
 *   • reschedule    (window + fee)            — added 071
 *
 * Auth-first: the bearer + org membership are checked before the body is
 * validated. `platform_fee_bps` is intentionally NOT settable here — it's a
 * platform (Nexxus) control, surfaced read-only to tenants.
 *
 * Body (all optional; at least one required):
 *   { cancellation_window_hours, cancellation_fee_type, cancellation_fee_value,
 *     no_show_fee_type, no_show_fee_value,
 *     reschedule_window_hours, reschedule_fee_type, reschedule_fee_value }
 */
const FEE_TYPES = ['none', 'flat', 'percent'] as const;
type FeeType = (typeof FEE_TYPES)[number];

function validateFeeType(value: unknown, field: string) {
  if (!FEE_TYPES.includes(value as FeeType)) {
    return `${field} must be one of none, flat, percent`;
  }
  return null;
}

function validateWindowHours(value: unknown, field: string): { ok: true; value: number } | { ok: false; error: string } {
  const h = Number(value);
  if (!Number.isFinite(h) || h < 0 || h > 720) {
    return { ok: false, error: `${field} must be between 0 and 720` };
  }
  return { ok: true, value: Math.round(h) };
}

function validateFeeValue(
  value: unknown,
  feeType: string | undefined,
  field: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) {
    return { ok: false, error: `${field} must be >= 0` };
  }
  if (feeType === 'percent' && v > 100) {
    return { ok: false, error: `${field} percent fee cannot exceed 100` };
  }
  return { ok: true, value: v };
}

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
      cancellation_window_hours?: number;
      cancellation_fee_type?: string;
      cancellation_fee_value?: number;
      no_show_fee_type?: string;
      no_show_fee_value?: number;
      reschedule_window_hours?: number;
      reschedule_fee_type?: string;
      reschedule_fee_value?: number;
    };

    const update: Record<string, unknown> = {};

    // ── Cancellation ─────────────────────────────────────────────────────
    if (body.cancellation_fee_type !== undefined) {
      const err = validateFeeType(body.cancellation_fee_type, 'cancellation_fee_type');
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      update.cancellation_fee_type = body.cancellation_fee_type;
    }
    if (body.cancellation_window_hours !== undefined) {
      const r = validateWindowHours(body.cancellation_window_hours, 'cancellation_window_hours');
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      update.cancellation_window_hours = r.value;
    }
    if (body.cancellation_fee_value !== undefined) {
      const r = validateFeeValue(body.cancellation_fee_value, body.cancellation_fee_type, 'cancellation_fee_value');
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      update.cancellation_fee_value = r.value;
    }

    // ── No-show ──────────────────────────────────────────────────────────
    if (body.no_show_fee_type !== undefined) {
      const err = validateFeeType(body.no_show_fee_type, 'no_show_fee_type');
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      update.no_show_fee_type = body.no_show_fee_type;
    }
    if (body.no_show_fee_value !== undefined) {
      const r = validateFeeValue(body.no_show_fee_value, body.no_show_fee_type, 'no_show_fee_value');
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      update.no_show_fee_value = r.value;
    }

    // ── Reschedule ───────────────────────────────────────────────────────
    if (body.reschedule_fee_type !== undefined) {
      const err = validateFeeType(body.reschedule_fee_type, 'reschedule_fee_type');
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      update.reschedule_fee_type = body.reschedule_fee_type;
    }
    if (body.reschedule_window_hours !== undefined) {
      const r = validateWindowHours(body.reschedule_window_hours, 'reschedule_window_hours');
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      update.reschedule_window_hours = r.value;
    }
    if (body.reschedule_fee_value !== undefined) {
      const r = validateFeeValue(body.reschedule_fee_value, body.reschedule_fee_type, 'reschedule_fee_value');
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      update.reschedule_fee_value = r.value;
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
