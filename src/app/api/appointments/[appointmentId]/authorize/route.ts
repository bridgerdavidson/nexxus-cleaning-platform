import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { authorizeAppointmentAuto, type AnyAuthorizeCode } from '@/lib/payments/authorizeDispatch';

/**
 * POST /api/appointments/:appointmentId/authorize
 *
 * Places (or re-places) the manual-capture authorization hold for an appointment that
 * already has a selected payment method. Org staff only. Normally fired by the JIT
 * authorizer cron ~24-48h pre-service, but exposed for admin-initiated/manual auth.
 *
 * Body: { organization_id }
 */
const HTTP_BY_CODE: Record<AnyAuthorizeCode, number> = {
  authorized: 200,
  requires_action: 402,
  declined: 402,
  no_card: 409,
  tenant_not_ready: 409,
  not_authorizable: 409,
  no_org_card: 409,
  cleaner_not_payable: 409,
  error: 500,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const { appointmentId } = await params;
    const body = await request.json().catch(() => ({}));
    const { organization_id } = body as { organization_id?: string };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    // Verify the appointment belongs to the caller's org (don't leak existence).
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('organization_id')
      .eq('id', appointmentId)
      .maybeSingle();
    if (!appt || (appt as { organization_id: string }).organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const outcome = await authorizeAppointmentAuto(supabaseAdmin, appointmentId, `user:${auth.userId}`);

    return NextResponse.json(
      {
        success: outcome.ok,
        code: outcome.code,
        ...(outcome.paymentIntentId ? { payment_intent_id: outcome.paymentIntentId } : {}),
        ...(outcome.message ? { message: outcome.message } : {}),
      },
      { status: HTTP_BY_CODE[outcome.code] ?? 400 },
    );
  } catch (error) {
    console.error('Error authorizing appointment:', error);
    return NextResponse.json(
      { error: 'Failed to authorize', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
