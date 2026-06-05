import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled, stripeAchEnabled, stripeSelfPayEnabled } from '@/lib/stripe/flags';
import { capturePaymentIntent } from '@/lib/stripe/charges/capture';
import { getPaymentMethodType } from '@/lib/stripe/customers/homeowner';
import { chargeAchAppointment } from '@/lib/payments/chargeAchAppointment';
import { chargeSelfPayAchAppointment } from '@/lib/payments/chargeSelfPayAchAppointment';
import { recordPaymentEvent } from '@/lib/payments/events';

// The self-pay/ACH branches below add a listSavedCards + PaymentIntent create on the request hot
// path; give the function headroom over the platform default so a slow Stripe call can't 504.
export const maxDuration = 60;

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

    // Org staff may capture any appointment in their org; a cleaner may capture ONLY the
    // appointment they're assigned to (they complete the job → capture-on-completion).
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'cleaner'],
    });
    if (!auth.ok) return auth.response;

    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, cleaner_id, payment_method_id, is_self_pay')
      .eq('id', appointmentId)
      .maybeSingle();
    const appointment = appt as
      | {
          id: string;
          organization_id: string;
          cleaner_id: string | null;
          payment_method_id: string | null;
          is_self_pay: boolean;
        }
      | null;
    if (!appointment || appointment.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    if (auth.role === 'cleaner' && appointment.cleaner_id !== auth.userId) {
      return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
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
      // No hold to capture. A bank-account (ACH) appointment has no hold — the debit is
      // created+confirmed now (charge-at-completion) and lands in `processing` for ~4 business days.

      // Org self-pay with no hold = its default company method is a bank (deferred at booking).
      // chargeSelfPayAchAppointment self-gates: it only debits when the default PM is a bank
      // (returns no_org_bank otherwise), so a card path that lost its hold falls through to 409.
      if (stripeAchEnabled() && stripeSelfPayEnabled() && appointment.is_self_pay) {
        const outcome = await chargeSelfPayAchAppointment(supabaseAdmin, appointmentId, `user:${auth.userId}`);
        if (outcome.ok) {
          return NextResponse.json({
            success: true,
            payment_intent_id: outcome.paymentIntentId,
            status: 'processing',
          });
        }
        // no_org_bank/no_org_card here means there's simply nothing to debit via ACH → 409 (same as
        // "no authorization to capture"); a genuine Stripe failure is 502.
        if (outcome.code !== 'no_org_bank' && outcome.code !== 'no_org_card') {
          return NextResponse.json(
            { error: outcome.message ?? 'ACH charge failed', code: outcome.code },
            { status: outcome.code === 'failed' || outcome.code === 'error' ? 502 : 409 },
          );
        }
      }

      if (stripeAchEnabled() && appointment.payment_method_id) {
        const pmType = await getPaymentMethodType(appointment.payment_method_id);
        if (pmType === 'us_bank_account') {
          const outcome = await chargeAchAppointment(supabaseAdmin, appointmentId, `user:${auth.userId}`);
          if (outcome.ok) {
            return NextResponse.json({
              success: true,
              payment_intent_id: outcome.paymentIntentId,
              status: 'processing',
            });
          }
          return NextResponse.json(
            { error: outcome.message ?? 'ACH charge failed', code: outcome.code },
            { status: outcome.code === 'failed' || outcome.code === 'error' ? 502 : 409 },
          );
        }
      }
      return NextResponse.json({ error: 'No authorization to capture' }, { status: 409 });
    }

    // Idempotent: a prior capture (double-submit, client retry, or the payment_intent.succeeded
    // webhook) may have already marked this paid. Don't re-capture — Stripe would throw because the
    // intent is no longer capturable, and we'd wrongly flip a paid job to "failed".
    if (pay.status === 'paid') {
      return NextResponse.json({
        success: true,
        payment_intent_id: pay.stripe_payment_intent_id,
        status: 'succeeded',
        alreadyCaptured: true,
      });
    }

    // A bank (ACH) debit is created+confirmed at completion and sits in `processing` for ~4 business
    // days; it has no hold to capture. A repeat completion must not try to capture it — that would
    // throw ("not capturable") and wrongly flip the clearing row to failed. It's already charging.
    if (pay.status === 'processing') {
      return NextResponse.json({
        success: true,
        payment_intent_id: pay.stripe_payment_intent_id,
        status: 'processing',
        alreadyCharging: true,
      });
    }

    let pi;
    try {
      pi = await capturePaymentIntent(pay.stripe_payment_intent_id);
    } catch (err) {
      // A concurrent capture / webhook may have succeeded between our read and this call. Re-check
      // before clobbering a now-paid job as failed.
      const { data: fresh } = await supabaseAdmin
        .from('payments')
        .select('status')
        .eq('id', pay.id)
        .maybeSingle();
      if ((fresh as { status: string } | null)?.status === 'paid') {
        return NextResponse.json({
          success: true,
          payment_intent_id: pay.stripe_payment_intent_id,
          status: 'succeeded',
          alreadyCaptured: true,
        });
      }
      // Genuine failure: reflect it so the admin pill reads "Failed" (not a stale "Unpaid") and the
      // appointment surfaces in "Payments needing attention" for re-authorization.
      await supabaseAdmin.from('payments').update({ status: 'failed' }).eq('id', pay.id);
      await supabaseAdmin
        .from('appointments')
        .update({ authorization_status: 'failed' })
        .eq('id', appointmentId);
      await recordPaymentEvent(supabaseAdmin, {
        paymentId: pay.id,
        appointmentId,
        organizationId: organization_id,
        eventType: 'capture_failed',
        prevStatus: pay.status,
        newStatus: 'failed',
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
