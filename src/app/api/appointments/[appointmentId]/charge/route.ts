import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { chargeCompletedAppointmentAuto, type ChargeNowCode } from '@/lib/payments/chargeCompletedAppointment';

// Charging now does an auth verify + several Supabase reads + a Stripe PaymentIntent create + writes;
// give it the same headroom as the authorize route so a slow Stripe call can't 504.
export const maxDuration = 60;

/**
 * POST /api/appointments/:appointmentId/charge
 *
 * Charges a COMPLETED appointment's saved card. This is the primary collection path: the card is
 * saved (not held) at booking, and the charge is created + auto-captured here once the job is marked
 * completed. The assigned cleaner (who completes the job) or org staff may trigger it; self-pay
 * requires the Manage Payments permission for managers. Settlement to the cleaner runs on the
 * payment_intent.succeeded webhook, with the reconciliation sweep as the backstop.
 *
 * Body: { organization_id }
 */
const HTTP_BY_CODE: Record<ChargeNowCode, number> = {
  charged: 200,
  processing: 200,
  requires_action: 402,
  declined: 402,
  no_card: 409,
  no_org_card: 409,
  no_org_bank: 409,
  bank_disabled: 409,
  tenant_not_ready: 409,
  cleaner_not_payable: 409,
  not_chargeable: 409,
  // A genuine Stripe failure from the ACH fallback (created+confirm threw), not a precondition.
  failed: 502,
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

    // Org staff may charge any appointment in their org; a cleaner may charge ONLY the appointment
    // they're assigned to (they complete the job -> charge-on-completion).
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'cleaner'],
    });
    if (!auth.ok) return auth.response;

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('organization_id, is_self_pay, cleaner_id')
      .eq('id', appointmentId)
      .maybeSingle();
    if (!appt || (appt as { organization_id: string }).organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (auth.role === 'cleaner' && (appt as { cleaner_id: string | null }).cleaner_id !== auth.userId) {
      return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
    }

    // Self-pay charges the org's company card — require Manage Payments for managers (owner/admin
    // always pass), same gate as the authorize route.
    if ((appt as { is_self_pay: boolean }).is_self_pay === true && auth.role === 'manager') {
      const { data: perms } = await supabaseAdmin
        .from('manager_permissions')
        .select('can_manage_payments')
        .eq('manager_id', auth.userId)
        .eq('organization_id', organization_id!)
        .maybeSingle();
      if (!(perms as { can_manage_payments: boolean } | null)?.can_manage_payments) {
        return NextResponse.json({ error: 'Requires the Manage Payments permission' }, { status: 403 });
      }
    }

    const outcome = await chargeCompletedAppointmentAuto(supabaseAdmin, appointmentId, `user:${auth.userId}`);

    return NextResponse.json(
      {
        success: outcome.ok,
        code: outcome.code,
        ...(outcome.paymentIntentId ? { payment_intent_id: outcome.paymentIntentId } : {}),
        ...(outcome.message ? { message: outcome.message } : {}),
        ...(!outcome.ok && outcome.message ? { error: outcome.message } : {}),
      },
      { status: HTTP_BY_CODE[outcome.code] ?? 400 },
    );
  } catch (error) {
    console.error('Error charging appointment:', error);
    return NextResponse.json(
      { error: 'Failed to charge', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
