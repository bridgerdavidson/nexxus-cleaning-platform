import { describe, it, expect } from 'vitest';
import { paymentStatusPill } from './paymentStatusPill';

describe('paymentStatusPill', () => {
  it('maps resolved charge states, regardless of any hold', () => {
    expect(paymentStatusPill('paid', 'authorized').label).toBe('Paid');
    expect(paymentStatusPill('refunded').label).toBe('Refunded');
    expect(paymentStatusPill('failed').label).toBe('Failed');
    expect(paymentStatusPill('processing').label).toBe('Clearing');
  });

  it('a resolved payment wins over the hold state', () => {
    // captured hold but the charge already settled → "Paid", not "Captured"
    expect(paymentStatusPill('paid', 'captured').label).toBe('Paid');
  });

  it('reflects the card-hold state while the payment is still pending', () => {
    expect(paymentStatusPill('pending', 'authorized').label).toBe('Card held');
    expect(paymentStatusPill('pending', 'requires_action').label).toBe('Action needed');
    expect(paymentStatusPill('pending', 'authorizing').label).toBe('Authorizing');
    expect(paymentStatusPill('pending', 'captured').label).toBe('Captured');
    expect(paymentStatusPill('pending', 'failed').label).toBe('Auth failed');
  });

  it('reflects the hold state when payment_status is null (hold placed, no charge row yet)', () => {
    expect(paymentStatusPill(null, 'authorized').label).toBe('Card held');
  });

  it('falls back to "Unpaid" with no charge and no live hold', () => {
    expect(paymentStatusPill('pending', 'none').label).toBe('Unpaid');
    expect(paymentStatusPill('pending', 'scheduled').label).toBe('Unpaid');
    expect(paymentStatusPill('pending', 'canceled').label).toBe('Unpaid');
    expect(paymentStatusPill('pending', null).label).toBe('Unpaid');
    expect(paymentStatusPill(null, null).label).toBe('Unpaid');
    expect(paymentStatusPill(undefined, undefined).label).toBe('Unpaid');
  });

  it('always returns non-empty label + className (never a blank chip)', () => {
    const cases: Array<Parameters<typeof paymentStatusPill>> = [
      ['paid'], ['processing'], ['failed'], ['refunded'], ['pending'],
      [null, 'authorized'], [undefined, undefined],
    ];
    for (const args of cases) {
      const pill = paymentStatusPill(...args);
      expect(pill.label.length).toBeGreaterThan(0);
      expect(pill.className).toMatch(/bg-\w+-\d+ text-\w+-\d+/);
    }
  });
});
