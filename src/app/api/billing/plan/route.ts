// Change an existing plan: tier up, tier down, seats up, seats down, or the
// monthly/annual switch, in ONE prorated subscriptions.update.
//
// NEVER guarded by requireWritable: a frozen organization must still be able to
// reach Checkout, and this route is that door when it has no live subscription.
// An org whose card is FAILING is refused separately below, with a 409 that
// points at the payment method rather than at a plan picker.
//
// Immediate prorated downgrades are an accepted deviation from the pricing
// doc's period-end downgrades (spec §18 item 1). They avoid Subscription
// Schedules entirely.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import {
  resolvePrices,
  retrieveSubscription,
  updateSubscriptionItems,
} from '@/lib/stripe/billing';
import {
  appendBillingEvent,
  buildBillingCheckoutSession,
  readLiveSubscription,
} from '@/lib/payments/orgBilling';
import { countSeatsInUse } from '@/lib/billing/seats';
import { diffSubscriptionItems } from '@/lib/billing/diffSubscriptionItems';
import { readCurrentItems } from '@/lib/billing/readCurrentItems';
import { parsePlanSelection, seatBoundsError, seatsInUseError } from '@/lib/billing/planSelection';
import {
  PLAN_TIERS,
  planChargeCents,
  type BillingPeriod,
  type PlanTier,
} from '@/lib/billing/plans';

export const runtime = 'nodejs';

/**
 * Does this change have to be invoiced NOW, or does it ride the next invoice?
 *
 * The rule is one comparison of what Stripe charges per cycle, which reproduces
 * the whole policy table:
 *
 *   | change                              | charge moves | invoice now |
 *   | tier or seats UP                    | up           | yes         |
 *   | tier or seats DOWN                  | down         | no          |
 *   | monthly to annual (buying a year)   | up           | yes         |
 *   | annual to monthly                   | down         | no          |
 *   | same charge (a seat shuffle)        | flat         | no          |
 *
 * Anything that raises the charge is billed immediately, because
 * `create_prorations` writes the proration lines without invoicing them: the
 * money would otherwise wait for the next scheduled invoice, which on an annual
 * plan is up to a year away. Anything that lowers it is left as a credit on the
 * next invoice; we never refund cash for a downgrade.
 *
 * A stored plan we cannot read is treated as an upgrade, which fails toward
 * charging rather than toward giving away service.
 */
function shouldInvoiceNow(
  stored: { planTier: string | null; billingPeriod: string | null; seatCount: number | null },
  target: { tier: PlanTier; period: BillingPeriod; seatCount: number },
): boolean {
  const tier = stored.planTier as PlanTier | null;
  const period = stored.billingPeriod as BillingPeriod | null;
  const seats = stored.seatCount;

  const readable =
    tier != null &&
    PLAN_TIERS.includes(tier) &&
    (period === 'monthly' || period === 'annual') &&
    typeof seats === 'number' &&
    Number.isFinite(seats);
  if (!readable) return true;

  const currentCents = planChargeCents(tier, period, seats);
  const targetCents = planChargeCents(target.tier, target.period, target.seatCount);
  return targetCents > currentCents;
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

    // The same read the checkout route uses, read in the opposite direction:
    // checkout refuses when this is true, this route falls back when it is false.
    const live = await readLiveSubscription(supabaseAdmin, organizationId);
    if (!live.found) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // No live subscription (trialing, trial_expired, canceled, or no id at all):
    // send them to checkout instead of erroring, so the client has one entry
    // point for "change my plan".
    if (!live.hasLiveSub) {
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

    // A failing card and a proration do not mix: `always_invoice` would add a
    // charge on top of one Stripe is already retrying, and `create_prorations`
    // on a downgrade would mint credit out of time the org has not paid for.
    // Refused only once there IS a live subscription, so the checkout fallback
    // above still works and the paywall never becomes a dead end.
    if (live.status === 'past_due' || live.status === 'unpaid') {
      return NextResponse.json(
        {
          error: 'billing_payment_required',
          message: 'Please update your payment method before changing your plan.',
          state: live.status,
        },
        { status: 409 },
      );
    }

    const subscriptionId = live.subscriptionId!;
    const sub = await retrieveSubscription(subscriptionId);
    const current = readCurrentItems(sub);
    const prices = await resolvePrices();
    const items = diffSubscriptionItems(current, { tier, period, seatCount }, prices);

    // PR F's preview endpoint MUST use this same direction logic, or the amount it
    // quotes will not match the amount charged. Extract this into a shared helper
    // when that endpoint lands.
    const invoiceNow = shouldInvoiceNow(live, { tier, period, seatCount });

    await updateSubscriptionItems(subscriptionId, items, organizationId, { invoiceNow });

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
      invoiced_now: invoiceNow,
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
