import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { createRefund } from '@/lib/stripe/charges/refund';
import { reverseJobTransfersForRefund } from '@/lib/payments/clawback';
import { recordPaymentEvent } from '@/lib/payments/events';

/**
 * POST /api/payments/:paymentId/refund
 *
 * Tenant admin/owner issues a refund. Unwinds the full cascade (separate charges and transfers):
 *   1) reverse (proportionally) every outbound transfer for the job — tenant remainder AND cleaner
 *      payout — so the platform balance is made whole before the refund
 *   2) refund the homeowner on the platform PaymentIntent (no reverse_transfer/refund_application_fee:
 *      the charge has no transfer_data, the funds were on the platform)
 * Records a `refunds` row + ledger event; marks the payment 'refunded' on a full refund.
 * The charge.refunded webhook confirms final state.
 *
 * Body: { organization_id, amount? (dollars; omit for full), reason? }
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
    const { organization_id, amount, reason } = body as {
      organization_id?: string;
      amount?: number;
      reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const { data: payRow } = await supabaseAdmin
      .from('payments')
      .select('id, organization_id, appointment_id, amount, status, stripe_payment_intent_id')
      .eq('id', paymentId)
      .maybeSingle();
    const payment = payRow as
      | {
          id: string;
          organization_id: string;
          appointment_id: string;
          amount: number | string;
          status: string;
          stripe_payment_intent_id: string | null;
        }
      | null;

    if (!payment || payment.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }
    if (payment.status !== 'paid' || !payment.stripe_payment_intent_id) {
      return NextResponse.json({ error: 'Payment is not in a refundable state' }, { status: 409 });
    }

    const grossCents = Math.round(Number(payment.amount) * 100);

    // Sum prior refunds (cents) to cap the refundable amount. Only count refunds that
    // returned money or are in-flight ('pending' → confirmed by the charge.refunded webhook,
    // 'succeeded'). A 'failed'/'canceled' refund returned nothing, so it must not reduce or
    // block a future valid refund.
    const { data: priorRefunds } = await supabaseAdmin
      .from('refunds')
      .select('amount')
      .eq('payment_id', payment.id)
      .in('status', ['pending', 'succeeded']);
    const alreadyRefunded = (priorRefunds ?? []).reduce(
      (sum, r) => sum + Number((r as { amount: number }).amount),
      0,
    );

    const isPartial = typeof amount === 'number';
    const refundCents = isPartial ? Math.round(amount! * 100) : grossCents - alreadyRefunded;

    if (refundCents <= 0 || refundCents > grossCents - alreadyRefunded) {
      return NextResponse.json({ error: 'Invalid refund amount' }, { status: 400 });
    }

    // 1) Refund the homeowner on the platform PaymentIntent FIRST. If this throws, nothing has
    //    moved yet, so a 502 leaves a clean state (no transfers reversed without a refund — the
    //    bug this reorder fixes). An idempotency key keyed on the amount means a double-submit
    //    can't create a second refund.
    let refund;
    try {
      refund = await createRefund({
        paymentIntentId: payment.stripe_payment_intent_id,
        amountCents: isPartial ? refundCents : undefined,
        reason,
        metadata: { appointment_id: payment.appointment_id, initiator_user_id: auth.userId },
        idempotencyKey: isPartial
          ? `refund-${payment.appointment_id}-${refundCents}`
          : `refund-${payment.appointment_id}-full`,
      });
    } catch (err) {
      return NextResponse.json(
        { error: 'Refund failed', details: err instanceof Error ? err.message : 'Unknown error' },
        { status: 502 },
      );
    }

    const { error: refundInsertError } = await supabaseAdmin.from('refunds').insert({
      organization_id,
      payment_id: payment.id,
      appointment_id: payment.appointment_id,
      stripe_refund_id: refund.id,
      amount: refundCents,
      reason: reason ?? null,
      initiator_user_id: auth.userId,
      status: 'pending',
    });
    if (refundInsertError) {
      // The Stripe refund already SUCCEEDED (money is back to the homeowner), so we must not return
      // a 5xx — a retry would refund again (modulo the idempotency key). Flag the ledger gap loudly
      // via the forensic event so it can be reconciled; the response carries ledger_recorded=false.
      console.error(
        `refund: Stripe refund ${refund.id} succeeded but the refunds-row insert failed:`,
        refundInsertError.message,
      );
      await recordPaymentEvent(supabaseAdmin, {
        paymentId: payment.id,
        appointmentId: payment.appointment_id,
        organizationId: organization_id,
        eventType: 'refund_ledger_write_failed',
        actor: `user:${auth.userId}`,
        amount: refundCents,
        payload: { refund_id: refund.id, error: refundInsertError.message },
      });
    }

    const nowFullyRefunded = alreadyRefunded + refundCents >= grossCents;
    if (nowFullyRefunded) {
      await supabaseAdmin.from('payments').update({ status: 'refunded' }).eq('id', payment.id);
    }

    // 2) Reclaim the platform's outbound transfers (tenant remainder AND cleaner payout) to match
    //    the CUMULATIVE refunded amount, and mirror the cleaner payout to 'reversed'. Runs AFTER
    //    the refund so a Stripe failure above can't leave the cleaner clawed back but the homeowner
    //    un-refunded. Idempotent (cumulative amount_reversed math) + best-effort: a failed cleaner
    //    reversal records `cleaner_clawback_failed` for the reconcile sweep and never blocks the
    //    (already-issued) refund.
    await reverseJobTransfersForRefund(supabaseAdmin, {
      appointmentId: payment.appointment_id,
      totalRefundedCents: alreadyRefunded + refundCents,
      grossCents,
      actor: `user:${auth.userId}`,
      paymentId: payment.id,
      organizationId: organization_id,
    });

    await recordPaymentEvent(supabaseAdmin, {
      paymentId: payment.id,
      appointmentId: payment.appointment_id,
      organizationId: organization_id,
      eventType: 'refunded',
      prevStatus: payment.status,
      newStatus: nowFullyRefunded ? 'refunded' : 'paid',
      actor: `user:${auth.userId}`,
      amount: refundCents,
      payload: { refund_id: refund.id, partial: isPartial },
    });

    return NextResponse.json({
      success: true,
      refund_id: refund.id,
      amount_cents: refundCents,
      fully_refunded: nowFullyRefunded,
      ledger_recorded: !refundInsertError,
    });
  } catch (error) {
    console.error('Error issuing refund:', error);
    return NextResponse.json(
      { error: 'Failed to issue refund', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
