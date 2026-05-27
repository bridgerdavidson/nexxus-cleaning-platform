import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
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
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'homeowner'],
    });
    if (!auth.ok) return auth.response;

    if (!payment_method_id) {
      return NextResponse.json({ error: 'payment_method_id is required' }, { status: 400 });
    }

    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, homeowner_id')
      .eq('id', appointmentId)
      .maybeSingle();
    const appt = apptRow as
      | { id: string; organization_id: string; homeowner_id: string }
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

    await supabaseAdmin
      .from('appointments')
      .update({ payment_method_id })
      .eq('id', appointmentId);

    await recordPaymentEvent(supabaseAdmin, {
      appointmentId,
      organizationId: organization_id,
      eventType: 'payment_method_set',
      actor: `user:${auth.userId}`,
      payload: { payment_method_id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error setting appointment payment method:', error);
    return NextResponse.json(
      { error: 'Failed to set payment method', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
