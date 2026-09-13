// First subscription purchase, via hosted Stripe Checkout.
//
// NEVER guarded by requireWritable: a frozen organization must be able to pay,
// or the paywall is a dead end.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { appendBillingEvent, buildBillingCheckoutSession } from '@/lib/payments/orgBilling';
import { countSeatsInUse } from '@/lib/billing/seats';
import { parsePlanSelection, seatBoundsError, seatsInUseError } from '@/lib/billing/planSelection';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const organizationId = body?.organization_id;

    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }
    const parsed = parsePlanSelection(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Owner or admin. Only the owner may change an existing plan; that is the
    // plan route's rule, not this one's.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const { tier, period, seatCount } = parsed.selection;

    const boundsError = seatBoundsError(tier, seatCount);
    if (boundsError) return NextResponse.json({ error: boundsError }, { status: 400 });

    // Deliberately NOT wrapped in a fail-open catch, unlike the invite route:
    // this decides what the customer is charged, and failing open would sell a
    // plan with fewer seats than the organization already uses.
    const seatsInUse = await countSeatsInUse(supabaseAdmin, organizationId);
    const usageError = seatsInUseError(seatCount, seatsInUse);
    if (usageError) return NextResponse.json({ error: usageError }, { status: 400 });

    const { sessionId, checkoutUrl } = await buildBillingCheckoutSession(
      supabaseAdmin,
      organizationId,
      parsed.selection,
    );

    await appendBillingEvent(supabaseAdmin, organizationId, 'app.checkout_started', {
      session_id: sessionId,
      tier,
      period,
      seat_count: seatCount,
    });

    return NextResponse.json({ success: true, data: { checkout_url: checkoutUrl } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
