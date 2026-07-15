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
  tenant_not_ready: 409,
  cleaner_not_payable: 409,
  not_chargeable: 409,
  // Another charge for this appointment won the atomic claim and is in flight (operator + homeowner
  // retry, or a double-click). The loser bows out here so only one real charge is created.
  charge_in_progress: 409,
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
    // they're assigned to (they complete the job -> charge-on-completion). A homeowner may self-collect
    // ("Pay now") ONLY on their own completed job whose auth is `failed` OR `null` (not yet charged) —
    // see the fail-closed allowlist below.
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'cleaner', 'homeowner'],
    });
    if (!auth.ok) return auth.response;

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('organization_id, is_self_pay, cleaner_id, homeowner_id, status, authorization_status')
      .eq('id', appointmentId)
      .maybeSingle();
    if (!appt || (appt as { organization_id: string }).organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (auth.role === 'cleaner' && (appt as { cleaner_id: string | null }).cleaner_id !== auth.userId) {
      return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
    }

    // Homeowner "Pay now": fail closed. A homeowner may only charge THEIR OWN appointment, and only
    // when it is a completed job whose off-session charge already `failed` OR was never charged
    // (`null`), and is NOT self-pay (self-pay draws on the company card, never a homeowner's). We
    // deliberately exclude `requires_action` (an off-session retry cannot clear 3DS, so it would
    // loop), `captured` (already paid), and `charging` (a charge is mid-flight). The existing
    // `alreadySettled` check downstream blocks an already-paid/processing job from a second charge.
    if (auth.role === 'homeowner') {
      const a = appt as {
        homeowner_id: string | null;
        status: string | null;
        authorization_status: string | null;
        is_self_pay: boolean | null;
      };
      const ok =
        a.homeowner_id === auth.userId &&
        a.status === 'completed' &&
        (a.authorization_status === 'failed' || a.authorization_status === null) &&
        !a.is_self_pay;
      if (!ok) {
        return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
      }
    }

    // Any manager-triggered charge requires Manage Payments (owner/admin always pass; the assigned
    // cleaner charging their own completed job is unaffected). Not limited to self-pay: a manager
    // charging a homeowner's saved card is still a payment-spending action.
    if (auth.role === 'manager') {
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

    const outcome = await chargeCompletedAppointmentAuto(
      supabaseAdmin,
      appointmentId,
      `user:${auth.userId}`,
      auth.role,
    );

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
