// First subscription purchase, via hosted Stripe Checkout.
//
// NEVER guarded by requireWritable: a frozen organization must be able to pay,
// or the paywall is a dead end.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { createBillingCheckoutSession, resolvePrices } from '@/lib/stripe/billing';
import { appendBillingEvent, getOrCreateOrgCustomer } from '@/lib/payments/orgBilling';
import { countSeatsInUse } from '@/lib/billing/seats';
import { requireAppUrl } from '@/lib/billing/appUrl';
import { billingTaxEnabled } from '@/lib/billing/flags';
import {
  PLANS,
  lookupKeyFor,
  seatBounds,
  seatLookupKeyFor,
  type BillingPeriod,
  type PlanTier,
} from '@/lib/billing/plans';

export const runtime = 'nodejs';

const TIERS: PlanTier[] = ['starter', 'growth', 'pro'];
const PERIODS: BillingPeriod[] = ['monthly', 'annual'];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const organizationId = body?.organization_id;
    const tier = body?.tier;
    const period = body?.period;
    const seatCount = body?.seat_count;

    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }
    if (typeof tier !== 'string' || !TIERS.includes(tier as PlanTier)) {
      return NextResponse.json(
        { error: 'Choose a plan tier of starter, growth, or pro.' },
        { status: 400 },
      );
    }
    if (typeof period !== 'string' || !PERIODS.includes(period as BillingPeriod)) {
      return NextResponse.json(
        { error: 'Choose a billing period of monthly or annual.' },
        { status: 400 },
      );
    }
    if (typeof seatCount !== 'number' || !Number.isInteger(seatCount)) {
      return NextResponse.json({ error: 'seat_count must be a whole number.' }, { status: 400 });
    }

    // Owner or admin. Only the owner may change an existing plan; that is the
    // plan route's rule, not this one's.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const planTier = tier as PlanTier;
    const planPeriod = period as BillingPeriod;
    const bounds = seatBounds(planTier);

    if (seatCount < bounds.min) {
      return NextResponse.json(
        { error: `${PLANS[planTier].name} includes ${bounds.min} seats, so buy at least ${bounds.min}.` },
        { status: 400 },
      );
    }
    if (bounds.max != null && seatCount > bounds.max) {
      return NextResponse.json(
        { error: `${PLANS[planTier].name} allows at most ${bounds.max} seats. Choose a larger plan.` },
        { status: 400 },
      );
    }

    // Deliberately NOT wrapped in a try/catch that fails open, unlike the invite
    // route: this decides what the customer is charged, and failing open would
    // sell a plan with fewer seats than the organization already uses.
    const seatsInUse = await countSeatsInUse(supabaseAdmin, organizationId);
    if (seatCount < seatsInUse) {
      return NextResponse.json(
        { error: `You have ${seatsInUse} cleaners, so buy at least ${seatsInUse} seats.` },
        { status: 400 },
      );
    }

    const prices = await resolvePrices();
    const extras = Math.max(0, seatCount - PLANS[planTier].includedSeats);
    const lineItems = [
      { price: prices[lookupKeyFor(planTier, planPeriod)], quantity: 1 },
      ...(extras > 0 ? [{ price: prices[seatLookupKeyFor(planPeriod)], quantity: extras }] : []),
    ];

    const customerId = await getOrCreateOrgCustomer(supabaseAdmin, organizationId);
    const appUrl = requireAppUrl();

    const session = await createBillingCheckoutSession({
      customerId,
      lineItems,
      organizationId,
      automaticTax: billingTaxEnabled(),
      successUrl: `${appUrl}/admin/settings?section=billing&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/admin/settings?section=billing&checkout=canceled`,
    });

    await appendBillingEvent(supabaseAdmin, organizationId, 'app.checkout_started', {
      session_id: session.id,
      tier: planTier,
      period: planPeriod,
      seat_count: seatCount,
    });

    return NextResponse.json({ success: true, data: { checkout_url: session.url } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
