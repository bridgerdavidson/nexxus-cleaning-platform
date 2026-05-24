import { describe, it, expect } from 'vitest';
import { computePaymentSplit } from './splits';

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
});
