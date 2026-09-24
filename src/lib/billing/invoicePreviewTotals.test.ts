import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { summarizePreviewInvoice } from './invoicePreviewTotals';

const NOW = 1_700_000_000;
const PERIOD_END = NOW + 15 * 86_400;
const NEXT_PERIOD_END = PERIOD_END + 30 * 86_400;

interface LineSpec {
  amount: number;
  start: number;
  end?: number;
  tax?: number;
  taxBehavior?: 'inclusive' | 'exclusive';
  /** Positive cents a coupon takes off this line. Stripe's `discount_amounts`. */
  discount?: number;
}

function line(spec: LineSpec) {
  return {
    amount: spec.amount,
    period: { start: spec.start, end: spec.end ?? PERIOD_END },
    // Stripe omits nothing here: a line with no coupon carries an empty array,
    // and prorations (discountable: false) carry an empty array too. Typed as
    // nullable so a fixture built from another invoice's real
    // Stripe.InvoiceLineItem[] still satisfies this helper's shape.
    discount_amounts: (spec.discount === undefined ? [] : [{ amount: spec.discount }]) as
      | { amount: number }[]
      | null,
    taxes:
      spec.tax === undefined
        ? null
        : [{ amount: spec.tax, tax_behavior: spec.taxBehavior ?? 'exclusive' }],
  };
}

function invoice(spec: {
  lines: ReturnType<typeof line>[];
  amountDue?: number;
  startingBalance?: number;
  hasMore?: boolean;
  totalTaxes?: number[];
}): Stripe.Invoice {
  return {
    amount_due: spec.amountDue ?? 0,
    starting_balance: spec.startingBalance ?? 0,
    total_taxes: (spec.totalTaxes ?? []).map((amount) => ({ amount })),
    lines: { data: spec.lines, has_more: spec.hasMore ?? false },
  } as unknown as Stripe.Invoice;
}

/**
 * Growth monthly (99.00) to Pro monthly (169.00), half way through the period,
 * 8% exclusive tax. Stripe returns the credit, the debit AND the next period
 * together, so amount_due (222.32) is a full period more than the 37.80 the
 * always_invoice update really charges today.
 */
const SAME_INTERVAL_UPGRADE = invoice({
  amountDue: 22232,
  totalTaxes: [1632],
  lines: [
    line({ amount: -4950, start: NOW, tax: -396 }),
    line({ amount: 8450, start: NOW, tax: 676 }),
    line({ amount: 16900, start: PERIOD_END, end: NEXT_PERIOD_END, tax: 1352 }),
  ],
});

describe('summarizePreviewInvoice', () => {
  it('bills only the lines whose period starts at the change, not the whole upcoming invoice', () => {
    const totals = summarizePreviewInvoice(SAME_INTERVAL_UPGRADE, NOW);
    // (-4950 - 396) + (8450 + 676)
    expect(totals.dueNowCents).toBe(3780);
    expect(totals.dueNowCents).not.toBe(22232);
    expect(totals.usedInvoiceTotalFallback).toBe(false);
  });

  it('reports the tax inside the amount due now, not the invoice-wide tax', () => {
    const totals = summarizePreviewInvoice(SAME_INTERVAL_UPGRADE, NOW);
    expect(totals.dueNowTaxCents).toBe(280); // -396 + 676, not 1632
  });

  it('reads the recurring price off the future period line, tax included', () => {
    expect(summarizePreviewInvoice(SAME_INTERVAL_UPGRADE, NOW).recurringCents).toBe(18252);
  });

  // Monthly to annual resets the billing cycle, so the new period's charge is a
  // NON-proration line that is billed on the spot. Counting proration lines only
  // would quote nothing for the largest charge we make.
  it('bills a cycle-resetting switch in full, even though the big line is not a proration', () => {
    const totals = summarizePreviewInvoice(
      invoice({
        amountDue: 92325,
        lines: [
          line({ amount: -2475, start: NOW }),
          line({ amount: 94800, start: NOW, end: NOW + 365 * 86_400 }),
        ],
      }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(92325);
    expect(totals.recurringCents).toBeNull();
  });

  it('spends the customer credit balance before charging, and never goes negative', () => {
    const totals = summarizePreviewInvoice(
      invoice({ ...{ amountDue: 0 }, lines: SAME_INTERVAL_UPGRADE.lines.data, startingBalance: -5000 }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(0);
    // Tax cannot survive inside a charge the credit wiped out.
    expect(totals.dueNowTaxCents).toBe(0);
  });

  it('applies a partial credit balance to the amount due now', () => {
    const totals = summarizePreviewInvoice(
      invoice({ lines: SAME_INTERVAL_UPGRADE.lines.data, startingBalance: -1000 }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(2780);
  });

  it('adds a balance the customer owes, rather than quoting under it', () => {
    const totals = summarizePreviewInvoice(
      invoice({ lines: SAME_INTERVAL_UPGRADE.lines.data, startingBalance: 1500 }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(5280);
  });

  it('counts inclusive tax as already inside the line amount', () => {
    const totals = summarizePreviewInvoice(
      invoice({ lines: [line({ amount: 1000, start: NOW, tax: 80, taxBehavior: 'inclusive' })] }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(1000);
    expect(totals.dueNowTaxCents).toBe(80);
  });

  it('adds exclusive tax on top of the line amount', () => {
    const totals = summarizePreviewInvoice(
      invoice({ lines: [line({ amount: 1000, start: NOW, tax: 80, taxBehavior: 'exclusive' })] }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(1080);
    expect(totals.dueNowTaxCents).toBe(80);
  });

  it('floors a net credit at zero rather than quoting a negative charge', () => {
    const totals = summarizePreviewInvoice(
      invoice({ amountDue: 0, lines: [line({ amount: -4950, start: NOW })] }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Coupons. The launch offer is a Stripe coupon and Checkout allows promotion
  // codes, so a discounted customer is the live case, not a hypothetical.
  //
  // A non-proration line's `amount` is GROSS, with the coupon sitting in
  // `discount_amounts`. Summing `amount` alone quotes the undiscounted price on
  // the renewal line, which is also what feeds the seat dialog's headline "New
  // monthly total" (seatCapTotalRow). THE MUTATION THESE CATCH: dropping the
  // `- discountsOn(line)` subtraction.
  // -------------------------------------------------------------------------

  /**
   * The same Growth to Pro upgrade as above, for a customer on a 20% repeating
   * coupon and with tax off. The two proration lines are discountable: false, so
   * Stripe has already netted them and their discount_amounts are empty. The
   * next-period line is gross 169.00 with 33.80 itemised against it.
   */
  const COUPON_UPGRADE = invoice({
    amountDue: 16320,
    lines: [
      line({ amount: -3960, start: NOW }),
      line({ amount: 6760, start: NOW }),
      line({ amount: 16900, start: PERIOD_END, end: NEXT_PERIOD_END, discount: 3380 }),
    ],
  });

  it('quotes the renewal net of a coupon, not the sticker price', () => {
    const totals = summarizePreviewInvoice(COUPON_UPGRADE, NOW);
    // 16900 - 3380. Quoting 16900 is telling a customer 169.00 while Stripe
    // takes 135.20.
    expect(totals.recurringCents).toBe(13520);
    expect(totals.recurringCents).not.toBe(16900);
  });

  it('leaves the due-now proration lines alone, which Stripe has already discounted', () => {
    const totals = summarizePreviewInvoice(COUPON_UPGRADE, NOW);
    // -3960 + 6760, with nothing subtracted twice.
    expect(totals.dueNowCents).toBe(2800);
  });

  // A cycle-resetting switch bills a FULL-PERIOD line today, and a full-period
  // line IS discountable, so the coupon has to come off the charged-today figure
  // as well. This is the largest charge we ever make.
  it('discounts a full-period line that is billed today', () => {
    const totals = summarizePreviewInvoice(
      invoice({
        amountDue: 73365,
        lines: [
          line({ amount: -2475, start: NOW }),
          line({ amount: 94800, start: NOW, end: NOW + 365 * 86_400, discount: 18960 }),
        ],
      }),
      NOW,
    );
    // -2475 + (94800 - 18960)
    expect(totals.dueNowCents).toBe(73365);
    expect(totals.dueNowCents).not.toBe(92325);
  });

  it('adds exclusive tax on top of the discounted amount, the way Stripe computes it', () => {
    const totals = summarizePreviewInvoice(
      invoice({
        lines: [line({ amount: 16900, start: NOW, discount: 3380, tax: 1082 })],
      }),
      NOW,
    );
    // (16900 - 3380) + 1082, where 1082 is 8% of the DISCOUNTED 13520.
    expect(totals.dueNowCents).toBe(14602);
    expect(totals.dueNowTaxCents).toBe(1082);
  });

  it('sums several discounts on one line', () => {
    const totals = summarizePreviewInvoice(
      invoice({
        lines: [
          {
            amount: 10000,
            period: { start: NOW, end: PERIOD_END },
            discount_amounts: [{ amount: 1000 }, { amount: 500 }],
            taxes: null,
          } as never,
        ],
      }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(8500);
  });

  // Fail HIGH, never low: a customer can be surprised by a smaller bill.
  it('falls back to the whole invoice when there are no lines to split', () => {
    const totals = summarizePreviewInvoice(
      invoice({ amountDue: 3780, totalTaxes: [280], lines: [] }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(3780);
    expect(totals.dueNowTaxCents).toBe(280);
    expect(totals.recurringCents).toBeNull();
    expect(totals.usedInvoiceTotalFallback).toBe(true);
  });

  it('falls back when the line list is only one page of many', () => {
    const totals = summarizePreviewInvoice(
      invoice({
        amountDue: 22232,
        totalTaxes: [1632],
        hasMore: true,
        lines: SAME_INTERVAL_UPGRADE.lines.data,
      }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(22232);
    expect(totals.usedInvoiceTotalFallback).toBe(true);
  });

  it('treats a line with no period as charged now', () => {
    const totals = summarizePreviewInvoice(
      invoice({ amountDue: 999, lines: [{ amount: 2500, taxes: null } as never] }),
      NOW,
    );
    expect(totals.dueNowCents).toBe(2500);
  });
});
