import { describe, it, expect } from 'vitest';
import { checkSplitInvariant } from './moneyMath';

describe('checkSplitInvariant', () => {
  it('passes when the recorded payout matches the locked split exactly', () => {
    // $100 gross, 80% cleaner, 0 bps platform fee → cleaner = floor(10000 * 80/100) = 8000.
    const r = checkSplitInvariant({
      grossCents: 10000,
      payoutPercent: 80,
      platformFeeBps: 0,
      recordedCleanerCents: 8000,
    });
    expect(r.ok).toBe(true);
    expect(r.expectedCleanerCents).toBe(8000);
    expect(r.driftCents).toBe(0);
    expect(r.tenantRemainderCents).toBe(2000);
  });

  it('flags a recorded payout that is too high', () => {
    const r = checkSplitInvariant({
      grossCents: 10000,
      payoutPercent: 80,
      platformFeeBps: 0,
      recordedCleanerCents: 9000, // overpaid by $10
    });
    expect(r.ok).toBe(false);
    expect(r.expectedCleanerCents).toBe(8000);
    expect(r.driftCents).toBe(1000);
  });

  it('flags a recorded payout that is too low', () => {
    const r = checkSplitInvariant({
      grossCents: 10000,
      payoutPercent: 80,
      platformFeeBps: 0,
      recordedCleanerCents: 7000,
    });
    expect(r.ok).toBe(false);
    expect(r.driftCents).toBe(-1000);
  });

  it('tolerates a single rounding cent', () => {
    // 33% of $100 = floor(3300) = 3300; recording 3301 is within the 1-cent tolerance.
    const r = checkSplitInvariant({
      grossCents: 10000,
      payoutPercent: 33,
      platformFeeBps: 0,
      recordedCleanerCents: 3301,
    });
    expect(r.expectedCleanerCents).toBe(3300);
    expect(r.driftCents).toBe(1);
    expect(r.ok).toBe(true);
  });

  it('accounts for the platform fee coming out of the tenant remainder, not the cleaner', () => {
    // 80% cleaner + 100 bps (1%) fee on $100: cleaner still floor(8000), fee = round(100),
    // tenant remainder = 10000 - 100 - 8000 = 1900. Cleaner is unaffected by the fee.
    const r = checkSplitInvariant({
      grossCents: 10000,
      payoutPercent: 80,
      platformFeeBps: 100,
      recordedCleanerCents: 8000,
    });
    expect(r.ok).toBe(true);
    expect(r.platformFeeCents).toBe(100);
    expect(r.tenantRemainderCents).toBe(1900);
  });

  it('treats a zero-percent (hourly_external) cleaner payout as valid only at 0', () => {
    expect(
      checkSplitInvariant({ grossCents: 10000, payoutPercent: 0, platformFeeBps: 0, recordedCleanerCents: 0 }).ok,
    ).toBe(true);
    expect(
      checkSplitInvariant({ grossCents: 10000, payoutPercent: 0, platformFeeBps: 0, recordedCleanerCents: 5000 }).ok,
    ).toBe(false);
  });
});
