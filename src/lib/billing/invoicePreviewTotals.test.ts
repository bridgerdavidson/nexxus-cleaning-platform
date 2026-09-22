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
}

function line(spec: LineSpec) {
  return {
    amount: spec.amount,
    period: { start: spec.start, end: spec.end ?? PERIOD_END },
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
