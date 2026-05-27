import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { createRefund } from '@/lib/stripe/charges/refund';
import { listTransfersByGroup, reversePlatformTransfer, transferGroupFor } from '@/lib/stripe/transfers';
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

    // 1) Reverse the platform's outbound transfers for this job (tenant remainder AND cleaner
    //    payout), proportionally to the refund, so the platform has the funds back to refund the
    //    homeowner. Best-effort per transfer — a failed reversal is logged and never blocks the refund.
    const transferGroup = transferGroupFor(payment.appointment_id);
    let jobTransfers: Awaited<ReturnType<typeof listTransfersByGroup>> = [];
    try {
      jobTransfers = await listTransfersByGroup(transferGroup);
    } catch (err) {
      await recordPaymentEvent(supabaseAdmin, {
        paymentId: payment.id,
        appointmentId: payment.appointment_id,
        organizationId: organization_id,
        eventType: 'transfer_list_failed',
        actor: `user:${auth.userId}`,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    // The cleaner payout row (if any) so we can mirror its reversed status.
    const { data: payoutRows } = await supabaseAdmin
      .from('payouts')
      .select('id, amount, stripe_transfer_id, status')
      .eq('appointment_id', payment.appointment_id)
      .not('stripe_transfer_id', 'is', null)
      .limit(1);
    const payout = payoutRows && payoutRows.length > 0
      ? (payoutRows[0] as { id: string; amount: number; stripe_transfer_id: string; status: string })
      : null;

    for (const t of jobTransfers) {
      const remainingCents = t.amount - (t.amount_reversed ?? 0);
      if (remainingCents <= 0) continue;
      const reversalCents = Math.min(remainingCents, Math.round((t.amount * refundCents) / grossCents));
      if (reversalCents <= 0) continue;
      try {
        await reversePlatformTransfer(t.id, reversalCents);
        if (payout && t.id === payout.stripe_transfer_id) {
          // Compare CUMULATIVE reversal (prior + this one) to the payout, so a series of partial
          // refunds that together fully reverse the transfer flips the payout to 'reversed'.
          const fullyReversed =
            (t.amount_reversed ?? 0) + reversalCents >= Math.round(Number(payout.amount) * 100);
          await supabaseAdmin
            .from('payouts')
            .update({
              status: fullyReversed ? 'reversed' : payout.status,
              reversed_at: new Date().toISOString(),
            })
            .eq('id', payout.id);
        }
      } catch (err) {
        await recordPaymentEvent(supabaseAdmin, {
          paymentId: payment.id,
          appointmentId: payment.appointment_id,
          organizationId: organization_id,
          eventType: 'transfer_reversal_failed',
          actor: `user:${auth.userId}`,
          amount: reversalCents,
          payload: { transfer_id: t.id, error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    // 2) Refund the homeowner on the platform PaymentIntent (funds reclaimed above).
    let refund;
    try {
      refund = await createRefund({
        paymentIntentId: payment.stripe_payment_intent_id,
        amountCents: isPartial ? refundCents : undefined,
        reason,
        metadata: { appointment_id: payment.appointment_id, initiator_user_id: auth.userId },
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
      // The Stripe refund already SUCCEEDED (money is back to the homeowner), so we must not
      // return a 5xx — a retry would refund again. Instead, flag the ledger gap loudly via the
      // forensic event so it can be reconciled; the response carries ledger_recorded=false.
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
