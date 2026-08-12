import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { recordPaymentEvent } from '@/lib/payments/events';

/**
 * POST /api/payouts/:payoutId/undismiss
 *
 * Put a dismissed failed cleaner-payout row back in the Payments "Needs you now" band:
 * the manual inverse of /dismiss (T2-9). UI-only: clears `attention_dismissed_at`; the
 * payout status and the reconciliation sweep are untouched. Idempotent — restoring a row
 * that was never dismissed succeeds as a no-op, so a stale sheet can't strand the click.
 * Org staff only (managers need can_manage_payments), mirroring /dismiss.
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
      .select('id, organization_id, appointment_id, status, attention_dismissed_at')
      .eq('id', payoutId)
      .maybeSingle();
    const payout = payoutRow as
      | {
          id: string;
          organization_id: string;
          appointment_id: string | null;
          status: string;
          attention_dismissed_at: string | null;
        }
      | null;
    if (!payout || payout.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
    }

    // Restoring is a payment-management action: managers need the explicit permission.
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

    // Only failed payouts live in the attention band, so only they can be restored to it.
    if (payout.status !== 'failed') {
      return NextResponse.json(
        { error: `Only a failed payout can be restored (this one is ${payout.status})` },
        { status: 409 },
      );
    }

    if (!payout.attention_dismissed_at) {
      // Never dismissed (or already restored): nothing to clear, and no ledger noise.
      return NextResponse.json({ success: true, already: true });
    }

    const { error: updErr } = await supabaseAdmin
      .from('payouts')
      .update({ attention_dismissed_at: null })
      .eq('id', payoutId);
    if (updErr) {
      return NextResponse.json({ error: 'Failed to restore payout' }, { status: 500 });
    }

    await recordPaymentEvent(supabaseAdmin, {
      appointmentId: payout.appointment_id,
      organizationId: payout.organization_id,
      eventType: 'payout_attention_undismissed',
      actor: `user:${auth.userId}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error restoring payout:', error);
    return NextResponse.json(
      { error: 'Failed to restore payout', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
