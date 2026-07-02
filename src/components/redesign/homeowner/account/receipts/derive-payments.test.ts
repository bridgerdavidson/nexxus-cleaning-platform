import { describe, it, expect } from 'vitest';
import { paymentBadgeKey, paymentServiceLabel } from './derive-payments';

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
