import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';
import { actOnPayRequest, loadPayRequest } from '@/lib/payments/payRequests/actOnPayRequest';

/**
 * POST /api/pay-requests/:payRequestId/counter
 * Org counters the cleaner's ask with a different amount (+ optional note).
 * The amount is hard-capped at the job price when the customer is billed (a
 * company-pays job accepts any amount); the cap and its error copy are
 * org-facing only. Body: { organization_id, amount_cents, note? }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ payRequestId: string }> },
) {
  try {
    const { payRequestId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      organization_id?: string;
      amount_cents?: number;
      note?: string;
    };

    const auth = await requireOrgPaymentsAuth(request, body.organization_id, supabaseAdmin);
    if (!auth.ok) return auth.response;

    if (typeof body.note === 'string' && body.note.length > 1000) {
      return NextResponse.json({ error: 'Note is too long (1000 characters max).' }, { status: 400 });
    }

    const loaded = await loadPayRequest(supabaseAdmin, payRequestId);
    if (!loaded || loaded.pr.organization_id !== body.organization_id) {
      return NextResponse.json({ error: 'Pay request not found' }, { status: 404 });
    }

    const result = await actOnPayRequest(supabaseAdmin, {
      payRequestId,
      action: 'org_counter',
      actorUserId: auth.userId,
      amountCents: body.amount_cents,
      note: body.note ?? null,
    });

    if (!result.ok) {
      if (result.code === 'over_price') {
        return NextResponse.json(
          {
            error:
              "Counter cannot exceed the job price. When the customer is billed, the cleaner is paid out of the customer's charge.",
          },
          { status: 400 },
        );
      }
      if (result.code === 'invalid_amount') {
        return NextResponse.json({ error: 'Enter a whole amount of 0 or more.' }, { status: 400 });
      }
      if (result.code === 'stale_state') {
        return NextResponse.json({ error: 'This request changed. Refresh and try again.' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Pay request not found' }, { status: 404 });
    }

    return NextResponse.json({ status: result.status });
  } catch (err) {
    console.error('pay-request counter failed:', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
