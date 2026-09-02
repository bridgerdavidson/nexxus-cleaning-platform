import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';
import {
  actOnPayRequest,
  loadPayRequest,
  triggerPayRequestSettlement,
} from '@/lib/payments/payRequests/actOnPayRequest';

/**
 * POST /api/pay-requests/:payRequestId/approve
 * Org approves the latest cleaner offer as-is. Capped at the job price only
 * when the customer is billed; a company-pays job accepts any amount (the org
 * funds it). Idempotent: re-approving an
 * approved thread is a 200 no-op (and still nudges settlement, which is
 * itself idempotent). Body: { organization_id, expected_amount_cents? };
 * when expected_amount_cents is present and the live offer differs, the
 * approval is rejected 409 so a stale tab can never move a different amount
 * than the operator saw.
 */
export const maxDuration = 60; // Stripe transfer latency headroom on the settlement trigger

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ payRequestId: string }> },
) {
  try {
    const { payRequestId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      organization_id?: string;
      expected_amount_cents?: number;
    };

    const auth = await requireOrgPaymentsAuth(request, body.organization_id, supabaseAdmin);
    if (!auth.ok) return auth.response;

    const loaded = await loadPayRequest(supabaseAdmin, payRequestId);
    // 404 (not 403) on cross-org so probing can't confirm the id exists.
    if (!loaded || loaded.pr.organization_id !== body.organization_id) {
      return NextResponse.json({ error: 'Pay request not found' }, { status: 404 });
    }

    const result = await actOnPayRequest(supabaseAdmin, {
      payRequestId,
      action: 'org_approve',
      actorUserId: auth.userId,
      ...(Number.isInteger(body.expected_amount_cents)
        ? { expectedAmountCents: body.expected_amount_cents as number }
        : {}),
    });

    if (!result.ok) {
      if (result.code === 'over_price') {
        return NextResponse.json(
          {
            error:
              "This ask is above the job price. When the customer is billed, the cleaner is paid out of the customer's charge, so counter with an amount up to the job price.",
          },
          { status: 400 },
        );
      }
      if (result.code === 'stale_state') {
        return NextResponse.json({ error: 'This request changed. Refresh and try again.' }, { status: 409 });
      }
      if (result.code === 'no_offer') {
        return NextResponse.json({ error: 'There is no cleaner ask to approve.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Pay request not found' }, { status: 404 });
    }

    const settlement = await triggerPayRequestSettlement(
      supabaseAdmin,
      loaded.pr.appointment_id,
      `user:${auth.userId}`,
    );

    return NextResponse.json({
      status: result.status,
      approvedAmountCents: result.approvedAmountCents,
      alreadyApproved: result.alreadyApproved,
      settlement,
    });
  } catch (err) {
    console.error('pay-request approve failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
