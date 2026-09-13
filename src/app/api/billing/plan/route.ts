// Change an existing plan: tier up, tier down, seats up, seats down, or the
// monthly/annual switch, in ONE prorated subscriptions.update.
//
// NEVER guarded by requireWritable: an `unpaid` organization changing plan is a
// legitimate act, and blocking it would make the paywall a dead end.
//
// Immediate prorated downgrades are an accepted deviation from the pricing
// doc's period-end downgrades (spec §18 item 1). They avoid Subscription
// Schedules entirely.

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import {
  resolvePrices,
  retrieveSubscription,
  updateSubscriptionItems,
} from '@/lib/stripe/billing';
import { appendBillingEvent, buildBillingCheckoutSession } from '@/lib/payments/orgBilling';
import { countSeatsInUse } from '@/lib/billing/seats';
import {
  diffSubscriptionItems,
  type CurrentSubscriptionItems,
} from '@/lib/billing/diffSubscriptionItems';
import { parsePlanSelection, seatBoundsError, seatsInUseError } from '@/lib/billing/planSelection';
import { seatLookupKeyFor, tierFor } from '@/lib/billing/plans';

export const runtime = 'nodejs';

/** Statuses that mean there is a subscription to change rather than one to buy. */
const LIVE_STATUSES = ['active', 'past_due', 'unpaid'];

const SEAT_LOOKUP_KEYS: string[] = [seatLookupKeyFor('monthly'), seatLookupKeyFor('annual')];

/**
 * Classify the subscription's items into the base plan line and the extra-seat
 * line. `items.data[].price.lookup_key` rides along on a plain retrieve, so no
 * extra fetch is needed.
 */
function readCurrentItems(sub: Stripe.Subscription): CurrentSubscriptionItems {
  let baseItemId: string | null = null;
  let basePriceLookupKey = '';
  let seatItemId: string | null = null;
  let seatQuantity = 0;

  for (const item of sub.items?.data ?? []) {
    const lookupKey = item.price?.lookup_key ?? '';
    if (tierFor(lookupKey)) {
      baseItemId = item.id;
      basePriceLookupKey = lookupKey;
    } else if (SEAT_LOOKUP_KEYS.includes(lookupKey)) {
      seatItemId = item.id;
      seatQuantity = item.quantity ?? 0;
    }
  }

  // No base line means this subscription was not created by this system, so
  // diffing it would quietly replace a price we do not understand.
  if (!baseItemId) {
    throw new Error('This subscription has no plan line we recognize. Contact support.');
  }

  return { baseItemId, basePriceLookupKey, seatItemId, seatQuantity };
}

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

    // Owner only, unlike checkout: an admin may start a subscription but may not
    // change an existing one.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner'],
    });
    if (!auth.ok) return auth.response;

    const { tier, period, seatCount } = parsed.selection;

    const boundsError = seatBoundsError(tier, seatCount);
    if (boundsError) return NextResponse.json({ error: boundsError }, { status: 400 });

    // Allowed to throw, exactly as in checkout: this decides what the customer
    // is charged, so a failed count must never be read as "no seats in use".
    const seatsInUse = await countSeatsInUse(supabaseAdmin, organizationId);
    const usageError = seatsInUseError(seatCount, seatsInUse);
    if (usageError) return NextResponse.json({ error: usageError }, { status: 400 });

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('subscription_id, subscription_status')
      .eq('id', organizationId)
      .maybeSingle();

    if (orgError) return NextResponse.json({ error: orgError.message }, { status: 500 });
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const subscriptionId = org.subscription_id as string | null;
    const hasLiveSub =
      Boolean(subscriptionId) && LIVE_STATUSES.includes(org.subscription_status as string);

    // No live subscription (trialing, trial_expired, canceled, or no id at all):
    // send them to checkout instead of erroring, so the client has one entry
    // point for "change my plan".
    if (!hasLiveSub) {
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
    }

    const sub = await retrieveSubscription(subscriptionId!);
    const current = readCurrentItems(sub);
    const prices = await resolvePrices();
    const items = diffSubscriptionItems(current, { tier, period, seatCount }, prices);

    await updateSubscriptionItems(subscriptionId!, items, organizationId);

    // Mirror immediately so the UI does not lag; the customer.subscription.updated
    // webhook is the real source of truth and overwrites these within seconds.
    await supabaseAdmin
      .from('organizations')
      .update({ plan_tier: tier, billing_period: period, seat_count: seatCount })
      .eq('id', organizationId);

    await appendBillingEvent(supabaseAdmin, organizationId, 'app.plan_changed', {
      tier,
      period,
      seat_count: seatCount,
      changed_by: auth.userId,
    });

    return NextResponse.json({ success: true, data: { updated: true } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
