import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { settleSelfPay } from '@/lib/payments/settleSelfPay';
import { recordPaymentEvent } from '@/lib/payments/events';

// Re-settling does Supabase reads + a Stripe transfer (sometimes two). Give it the same
// headroom as the authorize route so production latency doesn't kill it mid-transfer; the
// reconciliation sweep is still the backstop if it does fail.
export const maxDuration = 60;

// settleCleanerPayout reports WHY it couldn't settle via a reason code. Map the ones an admin
// can act on to plain copy; anything unmapped falls back to a generic retry message.
const REASON_MESSAGE: Record<string, string> = {
  cleaner_transfer_failed:
    "The transfer to the cleaner's payout account failed again. Make sure their Stripe payout setup is complete, then retry.",
  tenant_transfer_failed:
    "We couldn't move funds to the company account, so the cleaner wasn't paid. Please try again shortly.",
  tenant_not_ready: "The company's payout account isn't connected to Stripe yet.",
  nothing_captured: "This payout can't be retried: no captured payment was found for the appointment.",
  no_appointment: "This payout isn't linked to an appointment, so it can't be retried.",
  fully_refunded: 'The payment for this job was refunded, so there is nothing left to pay out.',
  cleaner_not_payable:
    "The cleaner can't receive payouts yet. Make sure their Stripe payout setup is complete, then retry.",
};

/**
 * POST /api/payouts/:payoutId/retry
 *
 * Force an immediate re-settlement of a failed or held cleaner payout instead of waiting for
 * the reconciliation sweep. Org staff only (managers need can_manage_payments). Routes through
 * the same idempotent settleCleanerPayout the sweep uses (idempotency key cleaner-payout-<id>),
 * so it pays the carved snapshot exactly once and can never double-pay.
 *
 * Body: { organization_id }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ payoutId: string }> },
) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const { payoutId } = await params;
    const body = await request.json().catch(() => ({}));
    const { organization_id } = body as { organization_id?: string };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    // Load the payout and verify it belongs to the caller's org (don't leak existence).
    const { data: payoutRow } = await supabaseAdmin
      .from('payouts')
      .select('id, organization_id, appointment_id, status, is_self_pay')
      .eq('id', payoutId)
      .maybeSingle();
    const payout = payoutRow as
      | {
          id: string;
          organization_id: string;
          appointment_id: string | null;
          status: string;
          is_self_pay: boolean | null;
        }
      | null;
    if (!payout || payout.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    // Retrying a payout is a payment-management action: managers need the explicit permission
    // (owner/admin always pass). Mirrors the authorize route's self-pay gate.
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

    // Only failed or held (pending) payouts are retryable. paid/reversed are terminal.
    if (payout.status !== 'failed' && payout.status !== 'pending') {
      return NextResponse.json({ error: `A ${payout.status} payout can't be retried` }, { status: 409 });
    }
    if (!payout.appointment_id) {
      return NextResponse.json({ error: REASON_MESSAGE.no_appointment }, { status: 409 });
    }

    await recordPaymentEvent(supabaseAdmin, {
      appointmentId: payout.appointment_id,
      organizationId: payout.organization_id,
      eventType: 'payout_retry_requested',
      actor: `user:${auth.userId}`,
    });

    // No platform charge id on a manual retry: settle falls back to an available-balance transfer
    // and pays the carved snapshot recorded on the existing payout row. Self-pay payouts settle
    // via settleSelfPay (settleCleanerPayout refuses them — the tenant-split math is wrong there).
    const result = payout.is_self_pay
      ? await settleSelfPay(supabaseAdmin, payout.appointment_id, null)
      : await settleCleanerPayout(supabaseAdmin, payout.appointment_id, null);

    if (!result.settled) {
      const message = (result.reason && REASON_MESSAGE[result.reason]) || 'Retry failed. Please try again.';
      return NextResponse.json({ success: false, reason: result.reason, error: message }, { status: 409 });
    }

    // settled === true but reason 'cleaner_slice_held' means the cleaner still isn't Connect-ready,
    // so the slice was re-held (queued) rather than paid. Tell the caller so the UI can say so.
    return NextResponse.json({ success: true, reason: result.reason ?? null });
  } catch (error) {
    console.error('Error retrying payout:', error);
    return NextResponse.json(
      { error: 'Failed to retry payout', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
