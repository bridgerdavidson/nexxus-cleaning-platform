import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { capturePaymentIntent } from '@/lib/stripe/charges/capture';
import { cancelAuthorization } from '@/lib/stripe/charges/cancel';
import { recordPaymentEvent } from '@/lib/payments/events';
import { computeCancellationFee } from '@/lib/payments/cancellationFee';

/**
 * POST /api/appointments/:appointmentId/cancel
 *
 * Cancel an appointment, applying the org's cancellation/no-show policy (decision #10):
 *   • Cleaner-caused cancel, or an on-time homeowner cancel → release the hold, charge $0.
 *   • Homeowner late-cancel (inside `cancellation_window_hours`) or no-show → capture a
 *     configurable flat or percent fee FROM the existing authorization (partial capture
 *     releases the remainder). The cleaner is never paid for a cancelled job.
 *
 * Org staff only. Body: { organization_id, party?: 'homeowner'|'cleaner'|'org',
 *                         no_show?: boolean, reason?: string }
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
    const {
      organization_id,
      party = 'org',
      no_show = false,
      reason,
    } = body as {
      organization_id?: string;
      party?: 'homeowner' | 'cleaner' | 'org';
      no_show?: boolean;
      reason?: string;
    };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, status, total_price, scheduled_date, scheduled_time')
      .eq('id', appointmentId)
      .maybeSingle();
    const appt = apptRow as
      | {
          id: string;
          organization_id: string;
          status: string;
          total_price: number | string;
          scheduled_date: string | null;
          scheduled_time: string | null;
        }
      | null;
    if (!appt || appt.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (appt.status === 'cancelled') {
      return NextResponse.json({ success: true, already_cancelled: true, fee_captured_cents: 0 });
    }

    // Org cancellation policy.
    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('cancellation_window_hours, cancellation_fee_type, cancellation_fee_value')
      .eq('id', organization_id)
      .maybeSingle();
    const org = orgRow as
      | { cancellation_window_hours: number; cancellation_fee_type: string; cancellation_fee_value: number | string }
      | null;

    const grossCents = Math.round(Number(appt.total_price) * 100);
    const { feeCents, insideWindow } = computeCancellationFee({
      party,
      noShow: no_show,
      grossCents,
      windowHours: org?.cancellation_window_hours ?? 24,
      feeType: org?.cancellation_fee_type ?? 'none',
      feeValue: Number(org?.cancellation_fee_value ?? 0),
      scheduledDate: appt.scheduled_date,
      scheduledTime: appt.scheduled_time,
    });

    // Mark cancelled FIRST so the fee capture's payment_intent.succeeded webhook sees a
    // cancelled appointment and skips cleaner settlement (see settleCleanerPayout guard).
    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from('appointments')
      .update({ status: 'cancelled', cancelled_at: nowIso, cancellation_reason: reason ?? null })
      .eq('id', appointmentId);

    // Latest authorization for this appointment, if any.
    const { data: payRows } = await supabaseAdmin
      .from('payments')
      .select('id, stripe_payment_intent_id, status, payment_intent_status')
      .eq('appointment_id', appointmentId)
      .eq('payment_type', 'revenue')
      .not('stripe_payment_intent_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    const pay = payRows && payRows.length > 0
      ? (payRows[0] as { id: string; stripe_payment_intent_id: string; status: string; payment_intent_status: string | null })
      : null;

    const hasLiveHold = !!pay?.stripe_payment_intent_id && pay.payment_intent_status === 'requires_capture';

    // No live hold → nothing to capture or release. Record intent + return.
    if (!hasLiveHold) {
      await recordPaymentEvent(supabaseAdmin, {
        paymentId: pay?.id ?? null,
        appointmentId,
        organizationId: organization_id,
        eventType: feeCents > 0 ? 'cancellation_fee_uncollectable' : 'appointment_cancelled',
        actor: `user:${auth.userId}`,
        amount: feeCents > 0 ? feeCents : null,
        payload: { party, no_show, inside_window: insideWindow, has_hold: false },
      });
      return NextResponse.json({ success: true, cancelled: true, fee_captured_cents: 0 });
    }

    // Capture the fee (partial) or release the whole hold.
    if (feeCents > 0) {
      const captureCents = Math.min(feeCents, grossCents);
      let pi;
      try {
        pi = await capturePaymentIntent(pay!.stripe_payment_intent_id, captureCents);
      } catch (err) {
        return NextResponse.json(
          { error: 'Cancellation fee capture failed', details: err instanceof Error ? err.message : 'Unknown error' },
          { status: 502 },
        );
      }
      await supabaseAdmin
        .from('appointments')
        .update({ authorization_status: 'captured', cancellation_fee_captured: captureCents })
        .eq('id', appointmentId);
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'paid',
          amount: captureCents / 100,
          captured_at: nowIso,
          paid_at: nowIso,
          payment_intent_status: pi.status,
        })
        .eq('id', pay!.id);
      await recordPaymentEvent(supabaseAdmin, {
        paymentId: pay!.id,
        appointmentId,
        organizationId: organization_id,
        eventType: 'cancellation_fee_captured',
        prevStatus: pay!.status,
        newStatus: 'paid',
        actor: `user:${auth.userId}`,
        amount: captureCents,
        payload: { party, no_show, inside_window: insideWindow, payment_intent_id: pi.id },
      });
      return NextResponse.json({ success: true, cancelled: true, fee_captured_cents: captureCents });
    }

    // No fee → release the hold.
    try {
      await cancelAuthorization(pay!.stripe_payment_intent_id);
    } catch (err) {
      return NextResponse.json(
        { error: 'Authorization release failed', details: err instanceof Error ? err.message : 'Unknown error' },
        { status: 502 },
      );
    }
    await supabaseAdmin
      .from('appointments')
      .update({ authorization_status: 'canceled' })
      .eq('id', appointmentId);
    await supabaseAdmin
      .from('payments')
      .update({ payment_intent_status: 'canceled' })
      .eq('id', pay!.id);
    await recordPaymentEvent(supabaseAdmin, {
      paymentId: pay!.id,
      appointmentId,
      organizationId: organization_id,
      eventType: 'authorization_canceled',
      prevStatus: pay!.status,
      newStatus: 'canceled',
      actor: `user:${auth.userId}`,
      payload: { party, no_show, inside_window: insideWindow },
    });
    return NextResponse.json({ success: true, cancelled: true, fee_captured_cents: 0 });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    return NextResponse.json(
      { error: 'Failed to cancel appointment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
