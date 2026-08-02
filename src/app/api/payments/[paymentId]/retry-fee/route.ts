import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { recordPaymentEvent } from '@/lib/payments/events';
import { chargeCancellationFee, type CancellationFeeCode } from '@/lib/payments/chargeCancellationFee';

// The retry does an auth verify + several reads + a Stripe PaymentIntent create; same headroom
// as the cancel/charge routes so a slow Stripe call can't 504.
export const maxDuration = 60;

const HTTP_BY_CODE: Record<CancellationFeeCode, number> = {
  charged: 200,
  failed: 402,
  uncollectable: 409,
  retry_in_progress: 409,
};

const CODE_MESSAGE: Partial<Record<CancellationFeeCode, string>> = {
  uncollectable:
    'There is no chargeable card on file for this fee. Add or update the card, then retry.',
  retry_in_progress: 'Another retry for this fee is already running. Give it a moment, then refresh.',
};

/**
 * POST /api/payments/:paymentId/retry-fee
 *
 * Re-attempts a FAILED cancellation/no-show fee, keyed on the failed payments row (T2-7). The
 * amount is the row's amount, the fee assessed at cancel time, never recomputed from current
 * policy. Runs through the same idempotent chargeCancellationFee the cancel route uses: the
 * attempt-counter claim + fresh idempotency key make a concurrent double-retry impossible, and
 * a fee that already collected short-circuits without charging again.
 *
 * Permitted callers: owner/admin; managers with Manage Payments; the OWNING homeowner (L-7),
 * except on a requires_action row, because an off-session retry can never clear 3DS.
 *
 * Body: { organization_id }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const { paymentId } = await params;
    const body = await request.json().catch(() => ({}));
    const { organization_id } = body as { organization_id?: string };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager', 'homeowner'],
    });
    if (!auth.ok) return auth.response;

    const { data: payRow } = await supabaseAdmin
      .from('payments')
      .select('id, organization_id, appointment_id, amount, status, charge_kind, payment_intent_status')
      .eq('id', paymentId)
      .maybeSingle();
    const payment = payRow as
      | {
          id: string;
          organization_id: string;
          appointment_id: string | null;
          amount: number | string;
          status: string;
          charge_kind: string | null;
          payment_intent_status: string | null;
        }
      | null;
    if (!payment || payment.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    // Load the appointment immediately (it may be null) so the caller gates below can run BEFORE
    // any state-revealing branch. A same-org homeowner or a manager without Manage Payments must
    // never learn a row's status/amount (e.g. the paid/processing no-op, or the fee-kind/appointment
    // 409s) via a paymentId that isn't theirs to see, so authorization comes first and every
    // downstream branch is reached only once the caller is already cleared for this row.
    const { data: apptRow } = payment.appointment_id
      ? await supabaseAdmin
          .from('appointments')
          .select('id, organization_id, homeowner_id, payment_method_id, reauth_count, status')
          .eq('id', payment.appointment_id)
          .maybeSingle()
      : { data: null };
    const appt = apptRow as
      | {
          id: string;
          organization_id: string;
          homeowner_id: string | null;
          payment_method_id: string | null;
          reauth_count: number | null;
          status: string;
        }
      | null;

    // Homeowner allowlist, fail closed: no appointment on the row, or it belongs to someone else,
    // is the same 403 either way (never leaks which case it was).
    if (auth.role === 'homeowner') {
      if (!appt || appt.homeowner_id !== auth.userId) {
        return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
      }
    }

    // Retrying a fee is a payment-management action: managers need the explicit permission
    // (owner/admin always pass). Mirrors the payout retry route.
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

    // From here on the caller is already authorized for this row; state branches can now reveal
    // status/amount safely.
    if (payment.charge_kind !== 'cancellation_fee') {
      return NextResponse.json(
        { success: false, code: 'not_retryable', error: 'Only a cancellation or no-show fee can be retried here.' },
        { status: 409 },
      );
    }
    // Friendly no-op for a double-click or a stale sheet: the fee already collected.
    if (payment.status === 'paid' || payment.status === 'processing') {
      return NextResponse.json({
        success: true,
        code: 'charged',
        already: true,
        fee_captured_cents: Math.round(Number(payment.amount) * 100),
      });
    }
    if (payment.status !== 'failed') {
      return NextResponse.json(
        { success: false, code: 'not_retryable', error: `A ${payment.status} fee can't be retried.` },
        { status: 409 },
      );
    }

    if (!appt || appt.organization_id !== organization_id || appt.status !== 'cancelled') {
      return NextResponse.json(
        { success: false, code: 'not_retryable', error: 'This fee is not attached to a cancelled appointment.' },
        { status: 409 },
      );
    }

    // 3DS gate (409): ownership already holds for a homeowner caller by this point, so this is
    // purely a "can this retry succeed" check. An off-session retry can never clear requires_action,
    // it would just loop (same reasoning as the charge route).
    if (auth.role === 'homeowner' && payment.payment_intent_status === 'requires_action') {
      return NextResponse.json(
        {
          success: false,
          code: 'requires_card_verification',
          error: 'Your bank needs to verify this card. Update your card, then try again.',
        },
        { status: 409 },
      );
    }

    // Recover the original cancel context from the forensic ledger. It drives notification copy
    // and event payloads only, never the amount; a missing history falls back to homeowner-fault
    // defaults (the only party a fee is ever assessed against).
    const { data: feeEvents } = await supabaseAdmin
      .from('payment_events')
      .select('payload')
      .eq('appointment_id', appt.id)
      .in('event_type', ['cancellation_fee_failed', 'cancellation_fee_charged', 'cancellation_fee_uncollectable'])
      .order('created_at', { ascending: false })
      .limit(1);
    const payload = ((feeEvents?.[0] as { payload?: Record<string, unknown> } | undefined)?.payload ?? {}) as Record<string, unknown>;
    const context = {
      party: typeof payload.party === 'string' ? payload.party : 'homeowner',
      noShow: payload.no_show === true,
      insideWindow: payload.inside_window !== false,
    };

    const feeCents = Math.round(Number(payment.amount) * 100);

    await recordPaymentEvent(supabaseAdmin, {
      paymentId: payment.id,
      appointmentId: appt.id,
      organizationId: organization_id,
      eventType: 'cancellation_fee_retry_requested',
      actor: `user:${auth.userId}`,
      amount: feeCents,
      payload: { role: auth.role },
    });

    const outcome = await chargeCancellationFee(
      supabaseAdmin,
      {
        id: appt.id,
        organization_id: appt.organization_id,
        homeowner_id: appt.homeowner_id,
        payment_method_id: appt.payment_method_id,
        reauth_count: appt.reauth_count,
      },
      feeCents,
      `user:${auth.userId}`,
      context,
    );

    const ok = outcome.code === 'charged';
    return NextResponse.json(
      {
        success: ok,
        code: outcome.code,
        fee_captured_cents: outcome.feeCapturedCents,
        ...(!ok ? { error: outcome.message ?? CODE_MESSAGE[outcome.code] ?? 'Retry failed. Please try again.' } : {}),
      },
      { status: HTTP_BY_CODE[outcome.code] ?? 500 },
    );
  } catch (error) {
    console.error('Error retrying cancellation fee:', error);
    return NextResponse.json(
      { error: 'Failed to retry fee', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
