import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { cancelAuthorization } from '@/lib/stripe/charges/cancel';
import { recordPaymentEvent } from '@/lib/payments/events';

/**
 * POST /api/appointments/:appointmentId/cancel-authorization
 *
 * Cancels a not-yet-captured authorization (releases the card hold; no money moves).
 * Used when an appointment is cancelled before completion. Org staff only.
 *
 * Body: { organization_id }
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
    const { organization_id } = body as { organization_id?: string };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id')
      .eq('id', appointmentId)
      .maybeSingle();
    if (!appt || (appt as { organization_id: string }).organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const { data: payRows } = await supabaseAdmin
      .from('payments')
      .select('id, stripe_payment_intent_id, status')
      .eq('appointment_id', appointmentId)
      .eq('payment_type', 'revenue')
      .not('stripe_payment_intent_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    const pay = payRows && payRows.length > 0
      ? (payRows[0] as { id: string; stripe_payment_intent_id: string; status: string })
      : null;

    if (!pay?.stripe_payment_intent_id) {
      return NextResponse.json({ error: 'No authorization to cancel' }, { status: 409 });
    }

    try {
      await cancelAuthorization(pay.stripe_payment_intent_id);
    } catch (err) {
      return NextResponse.json(
        { error: 'Cancel failed', details: err instanceof Error ? err.message : 'Unknown error' },
        { status: 502 },
      );
    }

    await supabaseAdmin.from('appointments').update({ authorization_status: 'canceled' }).eq('id', appointmentId);
    await supabaseAdmin
      .from('payments')
      .update({ payment_intent_status: 'canceled' })
      .eq('id', pay.id);

    await recordPaymentEvent(supabaseAdmin, {
      paymentId: pay.id,
      appointmentId,
      organizationId: organization_id,
      eventType: 'authorization_canceled',
      prevStatus: pay.status,
      newStatus: 'canceled',
      actor: `user:${auth.userId}`,
      payload: { payment_intent_id: pay.stripe_payment_intent_id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error cancelling authorization:', error);
    return NextResponse.json(
      { error: 'Failed to cancel authorization', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
