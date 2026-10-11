// Turns a Stripe PREVIEW invoice into the two numbers a customer is shown
// before a plan change: what they are charged at the moment of the change, and
// what the plan costs per period afterwards.
//
// Pure, so the money arithmetic is testable without Stripe or a database.
//
// WHY THIS IS NOT `invoice.amount_due`
// ------------------------------------
// invoices.createPreview does not return "the invoice this change would cut".
// It returns the customer's UPCOMING invoice with the change applied, which for
// a same-interval upgrade carries the proration lines AND the next period's
// recurring lines together. Stripe's own prorations guide shows amount_due 3627
// made of a -166 credit, a 541 proration and a 3252 next-period charge, where
// the amount actually billed on the spot by `always_invoice` is 375. Quoting
// amount_due there would overstate an upgrade by a full period.
//
// Splitting on the proration flag alone is wrong in the other direction: a
// change of billing interval (monthly to annual) RESETS the billing cycle, so
// the new period's charge is a non-proration line that is nevertheless billed
// immediately. Counting only proration lines would quote roughly nothing for
// the single largest charge we make.
//
// So the split is by TIME, which is what Stripe's documented sample does: a
// line whose period starts at the proration instant is part of what is billed
// now; a line whose period starts later belongs to the next invoice. Passing
// `subscription_details.proration_date` makes that instant a known number
// instead of "whenever Stripe evaluated this".
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §10.4.

import type Stripe from 'stripe';

export interface InvoicePreviewTotals {
  /** Cents billed at the instant of the change, tax included. Never negative. */
  dueNowCents: number;
  /** Cents of tax inside dueNowCents. */
  dueNowTaxCents: number;
  /**
   * Cents the next full period costs at the new plan, tax included, or null when
   * the preview shows no future period (the caller then prices it from the
   * catalogue).
   */
  recurringCents: number | null;
  /**
   * True when the line split could not be trusted and dueNowCents fell back to
   * the whole upcoming invoice. The fallback is never smaller than the real
   * immediate charge, so it fails toward quoting high.
   */
  usedInvoiceTotalFallback: boolean;
}

interface LineTax {
  /** Tax added on top of the line amount. */
  exclusive: number;
  /** Tax already inside the line amount. */
  inclusive: number;
}

function taxesOn(line: Stripe.InvoiceLineItem): LineTax {
  const taxes = line.taxes ?? [];
  let exclusive = 0;
  let inclusive = 0;
  for (const tax of taxes) {
    const amount = tax?.amount ?? 0;
    if (tax?.tax_behavior === 'inclusive') inclusive += amount;
    else exclusive += amount;
  }
  return { exclusive, inclusive };
}

function sumInvoiceTaxes(invoice: Stripe.Invoice): number {
  return (invoice.total_taxes ?? []).reduce((sum, tax) => sum + (tax?.amount ?? 0), 0);
}

/**
 * What a coupon takes off this line, as a positive number of cents.
 *
 * A line's `amount` is GROSS of its discounts, which is only ever visible once
 * a customer holds a coupon: the launch offer is a Stripe coupon and Checkout
 * allows promotion codes, so this is the live case, not a hypothetical. Without
 * this subtraction a customer on a 20% repeating coupon is told "Then $169.00"
 * on the renewal line while Stripe takes $135.20, and the same number is the
 * seat dialog's headline "New monthly total" (seatCapTotalRow).
 *
 * Proration lines are `discountable: false`, so Stripe computes them from the
 * already-discounted price and they carry an EMPTY discount_amounts. Subtracting
 * here therefore cannot double-count them, and the same-interval due-now figure
 * is unchanged. It is also what keeps this correct if Stripe's recommended
 * `proration_discounts: 'itemized'` is ever switched on, where prorations do
 * arrive gross with their discounts itemised.
 */
function discountsOn(line: Stripe.InvoiceLineItem): number {
  return (line.discount_amounts ?? []).reduce((sum, d) => sum + (d?.amount ?? 0), 0);
}

/**
 * @param prorationDate the unix second passed as `subscription_details.proration_date`.
 */
export function summarizePreviewInvoice(
  invoice: Stripe.Invoice,
  prorationDate: number,
): InvoicePreviewTotals {
  const lines = invoice.lines?.data ?? [];

  // No lines, or more lines than one page holds, means the split would be built
  // on a partial view of the invoice. Quote the whole upcoming invoice instead:
  // it is always at least the immediate charge, so an operator can be surprised
  // by a smaller bill but never by a bigger one.
  if (lines.length === 0 || invoice.lines?.has_more === true) {
    const amountDue = Math.max(0, invoice.amount_due ?? 0);
    return {
      dueNowCents: amountDue,
      dueNowTaxCents: Math.min(Math.max(0, sumInvoiceTaxes(invoice)), amountDue),
      recurringCents: null,
      usedInvoiceTotalFallback: true,
    };
  }

  let dueNowSubtotal = 0;
  let dueNowTax = 0;
  let recurringSubtotal = 0;
  let sawFuturePeriod = false;

  for (const line of lines) {
    const tax = taxesOn(line);
    // NET of the line's own discounts. Stripe computes tax on the discounted
    // amount, so the tax figures need no adjustment of their own.
    const amount = (line.amount ?? 0) - discountsOn(line);
    // A missing period is treated as starting now, which puts it in the
    // charged-today bucket: the same fail-high direction as the fallback above.
    const startsAt = line.period?.start ?? 0;

    if (startsAt <= prorationDate) {
      dueNowSubtotal += amount + tax.exclusive;
      dueNowTax += tax.exclusive + tax.inclusive;
    } else {
      sawFuturePeriod = true;
      recurringSubtotal += amount + tax.exclusive;
    }
  }

  // starting_balance is the customer's Stripe credit balance: negative when they
  // hold credit (the usual case here, since a downgrade leaves one behind) and
  // positive when they owe. Stripe applies it to the invoice it cuts, so the
  // quote has to as well, floored at zero because an invoice cannot be negative.
  const balance = invoice.starting_balance ?? 0;
  const dueNowCents = Math.max(0, dueNowSubtotal + balance);

  return {
    dueNowCents,
    // Tax cannot exceed the amount it is inside of, which matters once the
    // credit balance has absorbed part or all of the charge.
    dueNowTaxCents: Math.min(Math.max(0, dueNowTax), dueNowCents),
    recurringCents: sawFuturePeriod ? Math.max(0, recurringSubtotal) : null,
    usedInvoiceTotalFallback: false,
  };
}
