import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { paymentMethodBelongsToCustomer } from '@/lib/stripe/customers/homeowner';
import { recordPaymentEvent } from '@/lib/payments/events';

/**
 * POST /api/appointments/:appointmentId/payment-method
 *
 * Sets (or changes) the saved card used for an appointment. Org staff acting on the
 * appointment's org, or the homeowner who owns it. The payment method must already be
 * attached to the homeowner's Stripe Customer — we never attach an arbitrary card here.
 *
 * This does NOT (re)authorize: a hold is placed on accept / by the JIT authorizer / via the
 * "Payments needing attention" re-authorize action. If a live hold exists on the previous card,
 * it stays until that re-authorization runs against the newly-selected card.
 *
 * Body: { organization_id, payment_method_id }
 */
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
    const { organization_id, payment_method_id } = body as {
      organization_id?: string;
      payment_method_id?: string;
    };

    // Org staff may set the card on any appointment in their org; a homeowner may set it ONLY on
    // their own appointment (checked against the bearer-verified user id below).
    const auth = await requireManagerPermission(request, organization_id, supabaseAdmin, 'can_manage_payments', {
      allowedRoles: ['owner', 'admin', 'manager', 'homeowner'],
      errorMessage: 'Requires the Manage Payments permission',
    });
    if (!auth.ok) return auth.response;

    if (!payment_method_id) {
      return NextResponse.json({ error: 'payment_method_id is required' }, { status: 400 });
    }

    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, homeowner_id, authorization_status, reauth_count')
      .eq('id', appointmentId)
      .maybeSingle();
    const appt = apptRow as
      | {
          id: string;
          organization_id: string;
          homeowner_id: string;
          authorization_status: string | null;
          reauth_count: number | null;
        }
      | null;
    if (!appt || appt.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (auth.role === 'homeowner' && appt.homeowner_id !== auth.userId) {
      return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
    }

    const { data: hoRow } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', appt.homeowner_id)
      .maybeSingle();
    const customerId = (hoRow as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
    if (!customerId) {
      return NextResponse.json({ error: 'Homeowner has no payment profile' }, { status: 409 });
    }

    const belongs = await paymentMethodBelongsToCustomer(customerId, payment_method_id);
    if (!belongs) {
      return NextResponse.json(
        { error: 'Payment method does not belong to this customer' },
        { status: 403 },
      );
    }

    // Changing the card on a FAILED appointment clears the failure: it reads "Unpaid" again and is
    // charged on the new card (at completion, or now via the drawer's charge-now for a finished
    // job). Bump reauth_count so the next charge uses a new idempotency key (the declined PI is
    // cached under the old key) and detach the dead PI from the revenue row so the pill (derived
    // from payments.status) flips back to pending.
    const wasFailed = appt.authorization_status === 'failed';
    const apptUpdate: Record<string, unknown> = { payment_method_id };
    if (wasFailed) {
      apptUpdate.authorization_status = null;
      apptUpdate.reauth_count = (appt.reauth_count ?? 0) + 1;
    }
    // Belt-and-suspenders: if a completion charge raced in between our read above and this write and
    // claimed the row (authorization_status = 'charging', see chargeCompletedAppointment.ts), don't
    // let this write clobber that claim. Normal state on this path is 'failed' (or null, pre-charge),
    // so the guard doesn't affect the ordinary reset. Use an OR (not a bare .neq) because SQL's
    // three-valued logic means `authorization_status <> 'charging'` alone excludes NULL rows too —
    // the same null-inclusive pattern the charge claim itself uses below.
    await supabaseAdmin
      .from('appointments')
      .update(apptUpdate)
      .eq('id', appointmentId)
      .or('authorization_status.neq.charging,authorization_status.is.null');

    if (wasFailed) {
      // Never reset a cancellation-fee row: the completion-charge lifecycle ("reads Unpaid,
      // charged at completion") doesn't exist on a cancelled appointment, and a fee row flipped
      // to pending is stranded forever (the fee retry endpoint only accepts failed rows). Use an
      // OR (not a bare .neq) because SQL's three-valued logic means `charge_kind <> 'cancellation_fee'`
      // alone excludes NULL rows too, and legacy null-kind failed rows are completion charges that
      // must still reset.
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'pending',
          stripe_payment_intent_id: null,
          payment_intent_status: null,
          authorized_at: null,
        })
        .eq('appointment_id', appointmentId)
        .eq('payment_type', 'revenue')
        .eq('status', 'failed')
        .or('charge_kind.neq.cancellation_fee,charge_kind.is.null');
    }

    await recordPaymentEvent(supabaseAdmin, {
      appointmentId,
      organizationId: organization_id,
      eventType: wasFailed ? 'payment_method_changed_reset' : 'payment_method_set',
      actor: `user:${auth.userId}`,
      payload: { payment_method_id, reset_from_failed: wasFailed },
    });

    return NextResponse.json({ success: true, reset: wasFailed });
  } catch (error) {
    console.error('Error setting appointment payment method:', error);
    return NextResponse.json(
      { error: 'Failed to set payment method', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
