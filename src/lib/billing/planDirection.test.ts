import { describe, expect, it } from 'vitest';
import { directionOf, shouldInvoiceNow, type StoredPlan } from './planDirection';
import { planChargeCents } from './plans';

const stored = (planTier: string | null, billingPeriod: string | null, seatCount: number | null): StoredPlan => ({
  planTier,
  billingPeriod,
  seatCount,
});

describe('directionOf', () => {
  // Pinned so a refactor of planChargeCents that quietly changes what a plan
  // costs fails here, not in front of a customer.
  it('is driven by what Stripe charges per cycle, not by tier order', () => {
    expect(planChargeCents('starter', 'monthly', 3)).toBe(3900);
    expect(planChargeCents('growth', 'monthly', 8)).toBe(9900);
    expect(planChargeCents('growth', 'monthly', 12)).toBe(13900);
    expect(planChargeCents('growth', 'annual', 8)).toBe(94800);
  });

  it('calls a tier rise an upgrade', () => {
    expect(directionOf(stored('starter', 'monthly', 3), { tier: 'growth', period: 'monthly', seatCount: 8 })).toBe(
      'upgrade',
    );
  });

  it('calls extra seats an upgrade', () => {
    expect(directionOf(stored('growth', 'monthly', 8), { tier: 'growth', period: 'monthly', seatCount: 12 })).toBe(
      'upgrade',
    );
  });

  // A year bought up front is the largest immediate charge there is.
  it('calls a switch to annual an upgrade', () => {
    expect(directionOf(stored('growth', 'monthly', 8), { tier: 'growth', period: 'annual', seatCount: 8 })).toBe(
      'upgrade',
    );
  });

  it('calls a tier drop a downgrade', () => {
    expect(directionOf(stored('growth', 'monthly', 8), { tier: 'starter', period: 'monthly', seatCount: 3 })).toBe(
      'downgrade',
    );
  });

  it('calls fewer seats a downgrade', () => {
    expect(directionOf(stored('growth', 'monthly', 12), { tier: 'growth', period: 'monthly', seatCount: 8 })).toBe(
      'downgrade',
    );
  });

  it('calls a switch back to monthly a downgrade', () => {
    expect(directionOf(stored('growth', 'annual', 8), { tier: 'growth', period: 'monthly', seatCount: 8 })).toBe(
      'downgrade',
    );
  });

  it('calls an identical plan unchanged', () => {
    expect(directionOf(stored('growth', 'monthly', 8), { tier: 'growth', period: 'monthly', seatCount: 8 })).toBe(
      'unchanged',
    );
  });

  // Fail toward charging: an unreadable stored plan must not hand out a free
  // upgrade, and an over-charge is recoverable where an under-charge is not.
  it.each<[string, StoredPlan]>([
    ['a null tier', stored(null, 'monthly', 8)],
    ['a null period', stored('growth', null, 8)],
    ['a null seat count', stored('growth', 'monthly', null)],
    ['a tier we do not sell', stored('enterprise', 'monthly', 8)],
    ['a period we do not sell', stored('growth', 'weekly', 8)],
    ['a seat count that is not a number', stored('growth', 'monthly', Number.NaN)],
  ])('treats %s as an upgrade', (_label, row) => {
    expect(directionOf(row, { tier: 'starter', period: 'monthly', seatCount: 3 })).toBe('upgrade');
  });
});

describe('shouldInvoiceNow', () => {
  it('invoices an upgrade now and defers everything else', () => {
    expect(shouldInvoiceNow(stored('starter', 'monthly', 3), { tier: 'growth', period: 'monthly', seatCount: 8 })).toBe(
      true,
    );
    expect(shouldInvoiceNow(stored('growth', 'monthly', 8), { tier: 'starter', period: 'monthly', seatCount: 3 })).toBe(
      false,
    );
    expect(shouldInvoiceNow(stored('growth', 'monthly', 8), { tier: 'growth', period: 'monthly', seatCount: 8 })).toBe(
      false,
    );
  });

  it('agrees with directionOf on every input', () => {
    const rows: StoredPlan[] = [
      stored('starter', 'monthly', 3),
      stored('growth', 'monthly', 8),
      stored('growth', 'annual', 8),
      stored('pro', 'monthly', 15),
      stored(null, null, null),
    ];
    const targets = [
      { tier: 'starter', period: 'monthly', seatCount: 3 },
      { tier: 'growth', period: 'annual', seatCount: 15 },
      { tier: 'pro', period: 'monthly', seatCount: 20 },
    ] as const;

    for (const row of rows) {
      for (const target of targets) {
        expect(shouldInvoiceNow(row, target)).toBe(directionOf(row, target) === 'upgrade');
      }
    }
  });
});
