import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { recordPaymentEvent } from '@/lib/payments/events';
import { computeCancellationFee } from '@/lib/payments/cancellationFee';
import { chargeCancellationFee } from '@/lib/payments/chargeCancellationFee';

// The homeowner-fault fee path adds a Stripe PaymentIntent create on the request hot path; give it
// headroom over the platform default so a slow Stripe call can't 504.
export const maxDuration = 60;

/**
 * POST /api/appointments/:appointmentId/cancel
 *
 * Cancel an appointment, applying the org's cancellation/no-show policy (decision #10):
 *   • Cleaner-caused cancel, or an on-time homeowner cancel -> charge $0.
 *   • Homeowner late-cancel (inside `cancellation_window_hours`) or no-show -> charge a configurable
 *     flat or percent fee to the saved card on file. With no upfront hold, the fee is collected by
 *     charging the card off-session at cancel time (idempotency key cancelfee-{id}); the cleaner is
 *     never paid for a cancelled job, so the fee settles to the tenant. Best-effort: a missing card,
 *     a bank-only payer, or a decline never blocks the cancellation.
 *   • Self-pay has no homeowner to charge, so it always cancels for $0.
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
      .select(
        'id, organization_id, status, total_price, scheduled_date, scheduled_time, is_self_pay, homeowner_id, payment_method_id',
      )
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
          is_self_pay: boolean;
          homeowner_id: string | null;
          payment_method_id: string | null;
        }
      | null;
    if (!appt || appt.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
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
    // Self-pay has no homeowner to charge a cancellation fee to (the org would be charging itself),
    // so a self-pay cancel always charges $0 — skip the policy entirely.
    let feeCents = 0;
    let insideWindow = false;
    if (!appt.is_self_pay) {
      const fee = computeCancellationFee({
        party,
        noShow: no_show,
        grossCents,
        windowHours: org?.cancellation_window_hours ?? 24,
        feeType: org?.cancellation_fee_type ?? 'none',
        feeValue: Number(org?.cancellation_fee_value ?? 0),
        scheduledDate: appt.scheduled_date,
        scheduledTime: appt.scheduled_time,
      });
      feeCents = fee.feeCents;
      insideWindow = fee.insideWindow;
    }

    // Mark cancelled BEFORE charging any fee so the fee charge's payment_intent.succeeded sees a
    // cancelled appointment and settles to the tenant only (settleCleanerPayout skips the cleaner).
    // Re-running on a retry is harmless; the fee charge below is independently idempotent.
    const alreadyCancelled = appt.status === 'cancelled';
    if (!alreadyCancelled) {
      const nowIso = new Date().toISOString();
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled', cancelled_at: nowIso, cancellation_reason: reason ?? null })
        .eq('id', appointmentId);
    }

    // No fee (on-time, cleaner-caused, or self-pay): nothing to charge.
    if (feeCents <= 0) {
      if (!alreadyCancelled) {
        await recordPaymentEvent(supabaseAdmin, {
          appointmentId,
          organizationId: organization_id,
          eventType: 'appointment_cancelled',
          actor: `user:${auth.userId}`,
          payload: { party, no_show, inside_window: insideWindow },
        });
      }
      return NextResponse.json({ success: true, cancelled: true, fee_captured_cents: 0 });
    }

    // Homeowner-fault fee: charge the saved card off-session. The helper is idempotent (Stripe key +
    // a paid-row guard), so a retry after a crash collects the fee without double-charging.
    const outcome = await chargeCancellationFee(
      supabaseAdmin,
      {
        id: appt.id,
        organization_id: appt.organization_id,
        homeowner_id: appt.homeowner_id,
        payment_method_id: appt.payment_method_id,
      },
      feeCents,
      `user:${auth.userId}`,
      { party, noShow: no_show, insideWindow },
    );

    return NextResponse.json({
      success: true,
      cancelled: true,
      fee_captured_cents: outcome.feeCapturedCents,
      fee_outcome: outcome.code,
      ...(outcome.message ? { fee_message: outcome.message } : {}),
    });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    return NextResponse.json(
      { error: 'Failed to cancel appointment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
