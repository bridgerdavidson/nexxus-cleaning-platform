import { describe, it, expect } from 'vitest';
import { computePaymentSplit, computePaymentSplitFromCents } from './splits';

describe('computePaymentSplitFromCents', () => {
  it('matches computePaymentSplit for an equivalent percent', () => {
    const pct = computePaymentSplit({ grossCents: 10000, payoutPercent: 60, platformFeeBps: 100 });
    const cents = computePaymentSplitFromCents({ grossCents: 10000, cleanerCents: 6000, platformFeeBps: 100 });
    expect(cents).toEqual(pct);
  });

  it('caps the fee at the remainder when the cleaner takes the whole gross', () => {
    const s = computePaymentSplitFromCents({ grossCents: 10000, cleanerCents: 10000, platformFeeBps: 100 });
    expect(s.platformFeeCents).toBe(0);
    expect(s.tenantRemainderCents).toBe(0);
  });

  it('always sums to gross', () => {
    for (const cleanerCents of [0, 1, 29999, 33332, 33333]) {
      const s = computePaymentSplitFromCents({ grossCents: 33333, cleanerCents, platformFeeBps: 100 });
      expect(s.platformFeeCents + s.cleanerCents + s.tenantRemainderCents).toBe(33333);
      expect(s.tenantRemainderCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('throws when cleanerCents exceeds gross', () => {
    expect(() => computePaymentSplitFromCents({ grossCents: 100, cleanerCents: 101, platformFeeBps: 0 })).toThrow();
  });

  it('throws on non-integer or negative inputs', () => {
    expect(() => computePaymentSplitFromCents({ grossCents: 100.5, cleanerCents: 50, platformFeeBps: 0 })).toThrow();
    expect(() => computePaymentSplitFromCents({ grossCents: 100, cleanerCents: -1, platformFeeBps: 0 })).toThrow();
    expect(() => computePaymentSplitFromCents({ grossCents: 100, cleanerCents: 50.5, platformFeeBps: 0 })).toThrow();
    expect(() => computePaymentSplitFromCents({ grossCents: 100, cleanerCents: 50, platformFeeBps: 10001 })).toThrow();
  });
});

describe('computePaymentSplit', () => {
  it('the canonical example: $100 gross, 80% cleaner, 0 fee → $80 cleaner / $20 tenant', () => {
    const split = computePaymentSplit({ grossCents: 10000, payoutPercent: 80, platformFeeBps: 0 });
    expect(split).toEqual({
      grossCents: 10000,
      platformFeeCents: 0,
      cleanerCents: 8000,
      tenantRemainderCents: 2000,
    });
  });

  it('hourly_external cleaner (0% payout) → tenant keeps everything after fee', () => {
    const split = computePaymentSplit({ grossCents: 10000, payoutPercent: 0, platformFeeBps: 0 });
    expect(split.cleanerCents).toBe(0);
    expect(split.tenantRemainderCents).toBe(10000);
  });

  it('applies a platform fee out of the tenant remainder, not the cleaner share', () => {
    // 3% fee on $100 = $3; cleaner still gets 80% of GROSS = $80; tenant keeps $17.
    const split = computePaymentSplit({ grossCents: 10000, payoutPercent: 80, platformFeeBps: 300 });
    expect(split.platformFeeCents).toBe(300);
    expect(split.cleanerCents).toBe(8000);
    expect(split.tenantRemainderCents).toBe(1700);
  });

  it('floors the cleaner share so totals never exceed gross (leftover cent → tenant)', () => {
    // $100.01 @ 33.333% would be 3333.6663 cents → floored to 3333.
    const split = computePaymentSplit({ grossCents: 10001, payoutPercent: 33.333, platformFeeBps: 0 });
    expect(split.cleanerCents).toBe(3333);
    expect(split.tenantRemainderCents).toBe(10001 - 3333);
  });

  it('maintains the invariant fee + cleaner + tenant === gross across many inputs', () => {
    const cases = [
      { grossCents: 1, payoutPercent: 50, platformFeeBps: 250 },
      { grossCents: 999, payoutPercent: 60, platformFeeBps: 0 },
      { grossCents: 12345, payoutPercent: 72.5, platformFeeBps: 175 },
      { grossCents: 250000, payoutPercent: 100, platformFeeBps: 0 },
      { grossCents: 7777, payoutPercent: 0, platformFeeBps: 10000 },
      { grossCents: 50000, payoutPercent: 85.25, platformFeeBps: 299 },
    ];
    for (const c of cases) {
      const s = computePaymentSplit(c);
      expect(s.platformFeeCents + s.cleanerCents + s.tenantRemainderCents).toBe(s.grossCents);
      expect(s.platformFeeCents).toBeGreaterThanOrEqual(0);
      expect(s.cleanerCents).toBeGreaterThanOrEqual(0);
      expect(s.tenantRemainderCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles zero gross', () => {
    const split = computePaymentSplit({ grossCents: 0, payoutPercent: 80, platformFeeBps: 300 });
    expect(split).toEqual({
      grossCents: 0,
      platformFeeCents: 0,
      cleanerCents: 0,
      tenantRemainderCents: 0,
    });
  });

  it('rejects invalid inputs', () => {
    expect(() => computePaymentSplit({ grossCents: -1, payoutPercent: 50, platformFeeBps: 0 })).toThrow(/non-negative integer/);
    expect(() => computePaymentSplit({ grossCents: 100.5, payoutPercent: 50, platformFeeBps: 0 })).toThrow(/non-negative integer/);
    expect(() => computePaymentSplit({ grossCents: 100, payoutPercent: 101, platformFeeBps: 0 })).toThrow(/between 0 and 100/);
    expect(() => computePaymentSplit({ grossCents: 100, payoutPercent: -1, platformFeeBps: 0 })).toThrow(/between 0 and 100/);
    expect(() => computePaymentSplit({ grossCents: 100, payoutPercent: 50, platformFeeBps: 10001 })).toThrow(/between 0 and 10000/);
  });

  describe('platform fee capped at the tenant remainder (never the cleaner share)', () => {
    it('a 100%-payout cleaner with a platform fee does NOT throw: the fee caps to 0', () => {
      // Before the cap this hit the underflow guard (cleaner 100% + fee 1% > gross), which
      // would crash settlement for any 100%-payout cleaner once platform_fee_bps > 0.
      const split = computePaymentSplit({ grossCents: 10000, payoutPercent: 100, platformFeeBps: 100 });
      expect(split.cleanerCents).toBe(10000);
      expect(split.platformFeeCents).toBe(0);
      expect(split.tenantRemainderCents).toBe(0);
    });

    it('a partial squeeze caps the fee to what the tenant has left', () => {
      // 99% cleaner leaves $1.00; a 2% fee ($2.00) caps to the $1.00 available.
      const split = computePaymentSplit({ grossCents: 10000, payoutPercent: 99, platformFeeBps: 200 });
      expect(split.cleanerCents).toBe(9900);
      expect(split.platformFeeCents).toBe(100);
      expect(split.tenantRemainderCents).toBe(0);
    });

    it('an uncapped fee is unchanged', () => {
      const split = computePaymentSplit({ grossCents: 10000, payoutPercent: 80, platformFeeBps: 100 });
      expect(split.platformFeeCents).toBe(100);
      expect(split.cleanerCents).toBe(8000);
      expect(split.tenantRemainderCents).toBe(1900);
    });

    it('invariant still holds at and around the cap boundary', () => {
      for (const payoutPercent of [98, 99, 99.5, 100]) {
        for (const platformFeeBps of [0, 50, 100, 200]) {
          const s = computePaymentSplit({ grossCents: 12345, payoutPercent, platformFeeBps });
          expect(s.platformFeeCents + s.cleanerCents + s.tenantRemainderCents).toBe(s.grossCents);
          expect(s.tenantRemainderCents).toBeGreaterThanOrEqual(0);
          expect(s.platformFeeCents).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
