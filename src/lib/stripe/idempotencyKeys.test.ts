import { describe, it, expect } from 'vitest';
import { transferIdempotencyKey, isIdempotencyConflictInFlight } from './idempotencyKeys';

/**
 * T1-11: attempt-suffixed transfer idempotency keys. Attempt 0 MUST stay the historical
 * unsuffixed key — settlements in flight across the deploy already spent those keys, and a
 * changed key would double-transfer on their retries.
 */
describe('transferIdempotencyKey', () => {
  it('keeps the unsuffixed base key at attempt 0', () => {
    expect(transferIdempotencyKey('tenant-payout-appt1', 0)).toBe('tenant-payout-appt1');
  });

  it('suffixes the attempt from 1 upward', () => {
    expect(transferIdempotencyKey('cleaner-payout-appt1', 1)).toBe('cleaner-payout-appt1-1');
    expect(transferIdempotencyKey('selfpay-cleaner-appt1', 3)).toBe('selfpay-cleaner-appt1-3');
  });

  it('treats a negative or NaN-ish attempt as 0 (unsuffixed)', () => {
    expect(transferIdempotencyKey('tenant-payout-appt1', -1)).toBe('tenant-payout-appt1');
    expect(transferIdempotencyKey('tenant-payout-appt1', NaN)).toBe('tenant-payout-appt1');
  });
});

/**
 * The concurrent in-flight conflict is the one Stripe error the catches must NOT rotate on: it
 * is not cached, and the in-flight winner's result becomes the key's cached response.
 */
describe('isIdempotencyConflictInFlight', () => {
  it('detects the conflict code on the error and on raw', () => {
    expect(
      isIdempotencyConflictInFlight(Object.assign(new Error('in flight'), { code: 'idempotency_key_in_use' })),
    ).toBe(true);
    expect(
      isIdempotencyConflictInFlight(
        Object.assign(new Error('in flight'), { raw: { code: 'idempotency_key_in_use' } }),
      ),
    ).toBe(true);
  });

  it('is false for other errors (including the cached params-mismatch idempotency_error)', () => {
    expect(isIdempotencyConflictInFlight(new Error('balance_insufficient'))).toBe(false);
    expect(
      isIdempotencyConflictInFlight(Object.assign(new Error('mismatch'), { code: 'idempotency_error' })),
    ).toBe(false);
    expect(isIdempotencyConflictInFlight(null)).toBe(false);
  });
});
