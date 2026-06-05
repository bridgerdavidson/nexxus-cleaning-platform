import { describe, it, expect } from 'vitest';
import {
  computeSelfPayAmounts,
  grossUpForStripeFee,
  STRIPE_PERCENT_FEE,
  STRIPE_FIXED_FEE_CENTS,
} from './selfPayMath';

/** Stripe's actual fee on a charge of `chargeCents` (percentage part rounded, then + fixed). */
function stripeFeeCents(chargeCents: number): number {
  if (chargeCents <= 0) return 0;
  return Math.round(chargeCents * STRIPE_PERCENT_FEE) + STRIPE_FIXED_FEE_CENTS;
}

describe('computeSelfPayAmounts', () => {
  it('canonical: $100 job, 80% cleaner → cleaner nets $80, org charged the grossed-up amount', () => {
    const a = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 80 });
    expect(a.cleanerCutCents).toBe(8000);
    // ceil((8000 + 30) / (1 - 0.029)) = ceil(8030 / 0.971) = ceil(8269.83) = 8270
    // (and Stripe's fee on 8270 = round(8270·0.029)+30 = 270, so net = exactly 8000)
    expect(a.chargeCents).toBe(8270);
    expect(a.estimatedFeeCents).toBe(a.chargeCents - a.cleanerCutCents);
    // After Stripe takes its real fee, the platform nets AT LEAST the cleaner's cut.
    expect(a.chargeCents - stripeFeeCents(a.chargeCents)).toBeGreaterThanOrEqual(a.cleanerCutCents);
  });

  it('cleaner cut is % of GROSS, floored (consistent with computePaymentSplit)', () => {
    // $100.01 @ 33.333% → 3333.66 cents floored to 3333.
    const a = computeSelfPayAmounts({ jobGrossCents: 10001, payoutPercent: 33.333 });
    expect(a.cleanerCutCents).toBe(3333);
  });

  it('the org charge always nets ≥ the cleaner cut after Stripe fees (cleaner kept whole)', () => {
    const cases = [
      { jobGrossCents: 1, payoutPercent: 100 }, // 1¢ cut — the smallest non-zero
      { jobGrossCents: 700, payoutPercent: 100 }, // $7 cut
      { jobGrossCents: 10000, payoutPercent: 5 }, // $5 cut
      { jobGrossCents: 10000, payoutPercent: 80 }, // $80 cut
      { jobGrossCents: 31250, payoutPercent: 80 }, // $250 cut
      { jobGrossCents: 99999, payoutPercent: 72.5 },
      { jobGrossCents: 250000, payoutPercent: 100 }, // $2500 cut
      { jobGrossCents: 333, payoutPercent: 33.333 }, // rounding boundary
    ];
    for (const c of cases) {
      const a = computeSelfPayAmounts(c);
      const net = a.chargeCents - stripeFeeCents(a.chargeCents);
      expect(net).toBeGreaterThanOrEqual(a.cleanerCutCents);
      // ...but never wildly over-charge: the gross-up overshoot is at most a couple cents.
      expect(net - a.cleanerCutCents).toBeLessThanOrEqual(2);
    }
  });

  it('a zero cut charges nothing (defensive — the self-pay gate already requires payout% > 0)', () => {
    const a = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 0 });
    expect(a.cleanerCutCents).toBe(0);
    expect(a.chargeCents).toBe(0);
    expect(a.estimatedFeeCents).toBe(0);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeSelfPayAmounts({ jobGrossCents: -1, payoutPercent: 80 })).toThrow();
    expect(() => computeSelfPayAmounts({ jobGrossCents: 100.5, payoutPercent: 80 })).toThrow();
    expect(() => computeSelfPayAmounts({ jobGrossCents: 100, payoutPercent: 101 })).toThrow();
    expect(() => computeSelfPayAmounts({ jobGrossCents: 100, payoutPercent: -1 })).toThrow();
  });
});

describe('computeSelfPayAmounts — method-aware fee (card vs bank)', () => {
  it('bank keeps the SAME cleaner cut as card but charges the cheaper ACH gross-up', () => {
    const card = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 80, method: 'card' });
    const bank = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 80, method: 'us_bank_account' });
    // The cleaner's cut is the % of gross — identical regardless of how the org pays.
    expect(bank.cleanerCutCents).toBe(card.cleanerCutCents);
    expect(bank.cleanerCutCents).toBe(8000);
    // ACH gross-up of an $80 cut: ceil(8000 / (1 - 0.008)) = ceil(8064.51) = 8065; 0.8% of 8065 = 65¢ ≤ $5 cap.
    expect(bank.chargeCents).toBe(8065);
    expect(bank.estimatedFeeCents).toBe(65);
    // Bank is strictly cheaper than card for the org.
    expect(bank.chargeCents).toBeLessThan(card.chargeCents);
  });

  it('bank fee is capped at $5 on a large cut', () => {
    const bank = computeSelfPayAmounts({ jobGrossCents: 250000, payoutPercent: 100, method: 'us_bank_account' });
    expect(bank.cleanerCutCents).toBe(250000);
    // Past the cap the fee is flat $5 (no fixed fee for ACH): charge = base + cap.
    expect(bank.chargeCents).toBe(250500);
    expect(bank.estimatedFeeCents).toBe(500);
  });

  it('defaults to card when method is omitted', () => {
    const omitted = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 80 });
    const card = computeSelfPayAmounts({ jobGrossCents: 10000, payoutPercent: 80, method: 'card' });
    expect(omitted.chargeCents).toBe(card.chargeCents);
    expect(omitted.estimatedFeeCents).toBe(card.estimatedFeeCents);
  });
});

describe('grossUpForStripeFee', () => {
  it('returns 0 for a 0 net', () => {
    expect(grossUpForStripeFee(0)).toBe(0);
  });

  it('ceils so the net after the real fee is never short', () => {
    for (const net of [1, 30, 80, 500, 2500, 8000, 25000, 123456]) {
      const charge = grossUpForStripeFee(net);
      const realNet = charge - (Math.round(charge * STRIPE_PERCENT_FEE) + STRIPE_FIXED_FEE_CENTS);
      expect(realNet).toBeGreaterThanOrEqual(net);
    }
  });

  it('rejects invalid input', () => {
    expect(() => grossUpForStripeFee(-1)).toThrow();
    expect(() => grossUpForStripeFee(10.5)).toThrow();
  });
});
