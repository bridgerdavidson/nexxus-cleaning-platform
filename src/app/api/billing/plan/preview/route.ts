// Price a plan change WITHOUT applying it, so the confirm step can state the
// exact amount before anyone is charged (rulings R7, R8, R21, and ROSCA
// pre-charge disclosure).
//
// READ ONLY. It writes nothing to Stripe and nothing to the database.
// invoices.createPreview creates no invoice. POST only because it carries a
// selection body.
//
// Every gate here is the SAME gate POST /api/billing/plan applies, in the same
// order, from the same helpers: owner only, the same seat rules, the same
// past_due refusal, the same direction logic (ruling R23). If the two ever
// disagree, this route quotes a change the apply call would reject, or a number
// it would not honour.

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { parsePlanSelection, seatBoundsError, seatsInUseError } from '@/lib/billing/planSelection';
import { countSeatsInUse } from '@/lib/billing/seats';
import { readLiveSubscription } from '@/lib/payments/orgBilling';
import {
  previewSubscriptionChange,
  resolvePrices,
  retrieveSubscription,
} from '@/lib/stripe/billing';
import { diffSubscriptionItems } from '@/lib/billing/diffSubscriptionItems';
import { readCurrentItems } from '@/lib/billing/readCurrentItems';
import { directionOf, type PlanChangeDirection } from '@/lib/billing/planDirection';
import { summarizePreviewInvoice } from '@/lib/billing/invoicePreviewTotals';
import { planChargeCents } from '@/lib/billing/plans';
import { billingTaxEnabled } from '@/lib/billing/flags';

export const runtime = 'nodejs';

export interface PlanPreviewPayload {
  /**
   * Charged now, in cents, tax included when the tax flag is on. Whatever the
   * preview invoice computes, never forced by direction (ruling R21 v2): a pure
   * downgrade reaches zero on its own, while an annual to monthly switch resets
   * the billing cycle and really is billed today.
   */
  due_now_cents: number;
  /** What the plan costs per period after this change, tax included when known. */
  recurring_cents: number;
  /**
   * ISO date of the NEXT invoice, or null when this preview cannot name one.
   *
   * Null whenever the previewed invoice is the one cut at the change (no
   * future-period line), because Stripe's `next_payment_attempt` is then
   * roughly now and the copy would print today's date as the next charge.
   * Consumers must omit the sentence rather than render a bare date.
   */
  next_charge_at: string | null;
  /** Cents of tax inside due_now_cents. 0 when this quote carries no tax. */
  tax_cents: number;
  /** True when the quote excludes tax, so the UI says tax is added at checkout. */
  tax_excluded: boolean;
  is_new_subscription: boolean;
  /**
   * Drives the SUPPORTING copy only (ruling R21 v2). The headline amount and
   * its label come from due_now_cents; direction explains a downgrade's credit.
   */
  direction: PlanChangeDirection;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const organizationId = body?.organization_id;
    if (typeof organizationId !== 'string' || !organizationId) {
      return NextResponse.json({ error: 'organization_id is required' }, { status: 400 });
    }

    const parsed = parsePlanSelection(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // Owner only, matching the apply route: quoting a price to someone who
    // cannot buy it is the dead control ruling R2 exists to prevent.
    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner'],
    });
    if (!auth.ok) return auth.response;

    const { tier, period, seatCount } = parsed.selection;

    const boundsError = seatBoundsError(tier, seatCount);
    if (boundsError) return NextResponse.json({ error: boundsError }, { status: 400 });

    // Allowed to throw, as in the apply route: a failed count must never be read
    // as "no seats in use". Quoting a seat count the apply call would refuse is
    // worse than showing the error here.
    const seatsInUse = await countSeatsInUse(supabaseAdmin, organizationId);
    const usageError = seatsInUseError(seatCount, seatsInUse);
    if (usageError) return NextResponse.json({ error: usageError }, { status: 400 });

    const live = await readLiveSubscription(supabaseAdmin, organizationId);
    if (!live.found) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const target = { tier, period, seatCount };
    const taxOn = billingTaxEnabled();

    // No live subscription: the apply route sends this selection to Checkout, so
    // there is nothing to prorate. Price it from the catalogue and say tax is
    // excluded, because Stripe only computes real tax once it has the address
    // the hosted page collects.
    if (!live.hasLiveSub) {
      const charge = planChargeCents(tier, period, seatCount);
      return NextResponse.json({
        success: true,
        data: {
          due_now_cents: charge,
          recurring_cents: charge,
          next_charge_at: null,
          tax_cents: 0,
          tax_excluded: true,
          is_new_subscription: true,
          direction: 'upgrade',
        } satisfies PlanPreviewPayload,
      });
    }

    // Same refusal as the apply route, and only once there IS a live
    // subscription, so the checkout path above is never blocked.
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

    const sub = await retrieveSubscription(live.subscriptionId!);
    const prices = await resolvePrices();
    const current = readCurrentItems(sub);
    const items = diffSubscriptionItems(current, target, prices);

    const prorationDate = Math.floor(Date.now() / 1000);
    const invoice = await previewSubscriptionChange({
      subscriptionId: live.subscriptionId!,
      items: items as unknown as Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[],
      prorationDate,
      automaticTax: taxOn,
    });

    const totals = summarizePreviewInvoice(invoice, prorationDate);
    const direction = directionOf(live, target);

    // Ruling R21 v2: the quote is whatever the invoice computes, for every
    // direction. summarizePreviewInvoice already splits the lines by period
    // against this pinned proration_date and applies the credit balance, so a
    // pure tier downgrade's negative prorations floor to zero on their own. An
    // annual to monthly switch does NOT: changing the interval resets the
    // billing cycle, so the new period's line starts at the proration date and
    // is billed today. Forcing that to zero would print "Nothing is charged
    // today" on a screen where Stripe invoices.
    return NextResponse.json({
      success: true,
      data: {
        due_now_cents: totals.dueNowCents,
        // The preview's own future-period lines when it has them: they carry the
        // new prices, any coupon, and tax, which the sticker price does not.
        recurring_cents: totals.recurringCents ?? planChargeCents(tier, period, seatCount),
        // Only when this preview actually HAS a future period.
        //
        // `next_payment_attempt` is when Stripe would collect the invoice it is
        // showing us. When the whole invoice lands in the due-now bucket (a
        // monthly to annual switch, or any cycle reset: recurringCents is null
        // because no line starts later), that invoice is the one cut at the
        // change, so its next_payment_attempt is roughly NOW. Stripe's own
        // preview sample returns period_end + 1h. Passing it through printed
        // "Charged today $923.25" above "Then $948.00 on <today>", which reads
        // as a second charge on the same day.
        //
        // Null is not a loss: renewalNoteFor and seatCapNotes already omit the
        // date clause and fall back to "Then $X every year" / "on your next
        // invoice", which is true. Deliberately NOT also nulled on "the date is
        // within a day": a change made on the last day of a period has a
        // genuine next charge tomorrow, and suppressing that would be wrong in
        // the other direction.
        next_charge_at:
          totals.recurringCents !== null && invoice.next_payment_attempt
            ? new Date(invoice.next_payment_attempt * 1000).toISOString()
            : null,
        // Already clamped to [0, dueNowCents] by summarizePreviewInvoice, so a
        // zero quote carries zero tax without a second rule here.
        tax_cents: totals.dueNowTaxCents,
        tax_excluded: !taxOn,
        is_new_subscription: false,
        direction,
      } satisfies PlanPreviewPayload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not price this change';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
