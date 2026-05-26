import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { capturePaymentIntent } from '@/lib/stripe/charges/capture';
import { recordPaymentEvent } from '@/lib/payments/events';

/**
 * POST /api/appointments/:appointmentId/capture
 *
 * Captures the held authorization on job completion. Org staff only. The
 * payment_intent.succeeded webhook idempotently confirms the DB state and (Phase 3)
 * settles the cleaner's share from the tenant balance; this route does an optimistic
 * update for immediate UI feedback.
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
      return NextResponse.json({ error: 'No authorization to capture' }, { status: 409 });
    }

    let pi;
    try {
      pi = await capturePaymentIntent(pay.stripe_payment_intent_id);
    } catch (err) {
      await recordPaymentEvent(supabaseAdmin, {
        paymentId: pay.id,
        appointmentId,
        organizationId: organization_id,
        eventType: 'capture_failed',
        actor: `user:${auth.userId}`,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
      return NextResponse.json(
        { error: 'Capture failed', details: err instanceof Error ? err.message : 'Unknown error' },
        { status: 502 },
      );
    }

    const now = new Date().toISOString();
    await supabaseAdmin.from('appointments').update({ authorization_status: 'captured' }).eq('id', appointmentId);
    await supabaseAdmin
      .from('payments')
      .update({ status: 'paid', captured_at: now, paid_at: now, payment_intent_status: pi.status })
      .eq('id', pay.id);

    await recordPaymentEvent(supabaseAdmin, {
      paymentId: pay.id,
      appointmentId,
      organizationId: organization_id,
      eventType: 'captured',
      prevStatus: pay.status,
      newStatus: 'paid',
      actor: `user:${auth.userId}`,
      payload: { payment_intent_id: pi.id, pi_status: pi.status },
    });

    return NextResponse.json({ success: true, payment_intent_id: pi.id, status: pi.status });
  } catch (error) {
    console.error('Error capturing appointment payment:', error);
    return NextResponse.json(
      { error: 'Failed to capture', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
