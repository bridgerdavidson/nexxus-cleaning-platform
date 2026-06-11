import { describe, it, expect } from 'vitest';
import { paymentStatusPill, type PillPaymentStatus } from './paymentStatusPill';

describe('paymentStatusPill', () => {
  it('maps each resolved charge state to its chip', () => {
    expect(paymentStatusPill('paid').label).toBe('Paid');
    expect(paymentStatusPill('refunded').label).toBe('Refunded');
    expect(paymentStatusPill('failed').label).toBe('Failed');
    // ACH debit clearing (~4 business days).
    expect(paymentStatusPill('processing').label).toBe('Clearing');
  });

  it('an unresolved appointment reads "Unpaid" (a saved card is charged at completion)', () => {
    expect(paymentStatusPill('pending').label).toBe('Unpaid');
    expect(paymentStatusPill(null).label).toBe('Unpaid');
    expect(paymentStatusPill(undefined).label).toBe('Unpaid');
  });

  it('always returns a non-empty label + className (never a blank chip)', () => {
    const cases: PillPaymentStatus[] = ['paid', 'processing', 'failed', 'refunded', 'pending', null, undefined];
    for (const s of cases) {
      const pill = paymentStatusPill(s);
      expect(pill.label.length).toBeGreaterThan(0);
      expect(pill.className).toMatch(/bg-\w+-\d+ text-\w+-\d+/);
    }
  });
});
