import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import {
  actOnPayRequest,
  loadPayRequest,
  triggerPayRequestSettlement,
} from '@/lib/payments/payRequests/actOnPayRequest';

/**
 * POST /api/pay-requests/:payRequestId/respond
 * The cleaner answers the org's counter: accept it, or counter back with a
 * new amount (which re-runs the auto-approve threshold and can approve on the
 * spot). Cleaner-only, own thread only.
 * Body: { organization_id, accept: true } OR { organization_id, amount_cents, note? }.
 */
export const maxDuration = 60; // settlement trigger may move money

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ payRequestId: string }> },
) {
  try {
    const { payRequestId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      organization_id?: string;
      accept?: boolean;
      amount_cents?: number;
      note?: string;
    };

    const auth = await requireOrgAuth(request, body.organization_id, supabaseAdmin, {
      allowedRoles: ['cleaner'],
    });
    if (!auth.ok) return auth.response;

    if (typeof body.note === 'string' && body.note.length > 1000) {
      return NextResponse.json({ error: 'Note is too long (1000 characters max).' }, { status: 400 });
    }
    if (body.accept !== true && body.amount_cents === undefined) {
      return NextResponse.json({ error: 'Accept the offer or send a new amount.' }, { status: 400 });
    }

    const loaded = await loadPayRequest(supabaseAdmin, payRequestId);
    // Own-thread only; 404 on anything else so ids can't be probed.
    if (!loaded || loaded.pr.organization_id !== body.organization_id || loaded.pr.cleaner_id !== auth.userId) {
      return NextResponse.json({ error: 'Pay request not found' }, { status: 404 });
    }

    const result = await actOnPayRequest(supabaseAdmin, {
      payRequestId,
      action: body.accept === true ? 'cleaner_accept' : 'cleaner_counter',
      actorUserId: auth.userId,
      amountCents: body.amount_cents,
      note: body.note ?? null,
    });

    if (!result.ok) {
      if (result.code === 'invalid_amount') {
        return NextResponse.json({ error: 'Enter a whole amount of 0 or more.' }, { status: 400 });
      }
      if (result.code === 'stale_state') {
        return NextResponse.json({ error: 'This request changed. Refresh and try again.' }, { status: 409 });
      }
      if (result.code === 'no_offer') {
        return NextResponse.json({ error: 'There is no offer to accept yet.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Pay request not found' }, { status: 404 });
    }

    let settlement: 'settled' | 'deferred' | undefined;
    if (result.status === 'approved') {
      settlement = await triggerPayRequestSettlement(
        supabaseAdmin,
        loaded.pr.appointment_id,
        `user:${auth.userId}`,
      );
    }

    return NextResponse.json({
      status: result.status,
      approvedAmountCents: result.approvedAmountCents,
      alreadyApproved: result.alreadyApproved,
      autoApproved: result.autoApproved,
      ...(settlement ? { settlement } : {}),
    });
  } catch (err) {
    console.error('pay-request respond failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
