import { describe, it, expect } from 'vitest';
import {
  isCancellationFee,
  paymentBadgeKey,
  paymentFeeBreakdown,
  paymentKindLabel,
  paymentServiceLabel,
  type PaymentLike,
} from './derive-payments';

function pmt(over: Partial<PaymentLike> = {}): PaymentLike {
  return { id: 'p1', amount: 100, status: 'paid', created_at: 'x', ...over };
}

describe('paymentBadgeKey', () => {
  it('passes through known statuses', () => {
    for (const s of ['paid', 'processing', 'pending', 'failed', 'refunded'] as const) {
      expect(paymentBadgeKey(s)).toBe(s);
    }
  });
  it('falls back to pending for unknown', () => {
    expect(paymentBadgeKey('weird')).toBe('pending');
    expect(paymentBadgeKey('')).toBe('pending');
  });
});

describe('paymentServiceLabel', () => {
  it('uses the appointment service name', () => {
    expect(
      paymentServiceLabel({
        id: 'p1',
        amount: 100,
        status: 'paid',
        created_at: 'x',
        appointment: { service_type: { name: 'Deep clean' } },
      }),
    ).toBe('Deep clean');
  });
  it('falls back to Cleaning when missing', () => {
    expect(paymentServiceLabel({ id: 'p1', amount: 100, status: 'paid', created_at: 'x' })).toBe(
      'Cleaning',
    );
  });
});

describe('charge kind (T2-14)', () => {
  it('detects a cancellation fee', () => {
    expect(isCancellationFee(pmt({ charge_kind: 'cancellation_fee' }))).toBe(true);
    expect(isCancellationFee(pmt({ charge_kind: 'completion' }))).toBe(false);
    expect(isCancellationFee(pmt({ charge_kind: null }))).toBe(false);
    expect(isCancellationFee(pmt())).toBe(false);
  });

  it('labels a cancellation fee distinctly from a normal cleaning payment', () => {
    expect(
      paymentKindLabel(pmt({ charge_kind: 'cancellation_fee', appointment: { service_type: { name: 'Deep clean' } } })),
    ).toBe('Cancellation fee');
    expect(
      paymentKindLabel(pmt({ charge_kind: 'completion', appointment: { service_type: { name: 'Deep clean' } } })),
    ).toBe('Deep clean');
  });
});

describe('paymentFeeBreakdown (T2-14)', () => {
  it('splits amount into subtotal + fee when a fee is present (amount is grossed up)', () => {
    expect(paymentFeeBreakdown(pmt({ amount: 123.89, processing_fee_cents: 389 }))).toEqual({
      subtotal: 120,
      fee: 3.89,
      total: 123.89,
    });
  });

  it('returns null when there is no fee to show', () => {
    expect(paymentFeeBreakdown(pmt({ processing_fee_cents: null }))).toBeNull();
    expect(paymentFeeBreakdown(pmt({ processing_fee_cents: 0 }))).toBeNull();
    expect(paymentFeeBreakdown(pmt())).toBeNull();
  });

  it('never lets the subtotal go negative', () => {
    const b = paymentFeeBreakdown(pmt({ amount: 1, processing_fee_cents: 500 }));
    expect(b?.subtotal).toBe(0);
    expect(b?.fee).toBe(5);
  });
});
