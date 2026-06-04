import { describe, it, expect } from 'vitest';
import {
  stripeFeeCents,
  grossUpForFee,
  computeChargeBreakdown,
  FEE_SCHEDULES,
  type PaymentMethodKind,
} from './processingFee';

// Independent fee models mirroring Stripe US pricing, used to validate the module
// without referencing its own internals.
function cardFee(c: number): number {
  return Math.round(c * 0.029) + 30;
}
function bankFee(c: number): number {
  return Math.min(Math.round(c * 0.008), 500);
}

describe('stripeFeeCents', () => {
  it('card = 2.9% + 30 cents', () => {
    expect(stripeFeeCents('card', 10000)).toBe(320); // 290 + 30
    expect(stripeFeeCents('card', 20000)).toBe(610); // 580 + 30
  });

  it('bank = 0.8%, no fixed fee, under the cap', () => {
    expect(stripeFeeCents('us_bank_account', 10000)).toBe(80); // 0.8% of $100
    expect(stripeFeeCents('us_bank_account', 20000)).toBe(160);
  });

  it('bank fee is capped at $5', () => {
    expect(stripeFeeCents('us_bank_account', 100000)).toBe(500); // would be $8 -> capped
    expect(stripeFeeCents('us_bank_account', 62500)).toBe(500); // $625 * 0.8% = exactly $5
    expect(stripeFeeCents('us_bank_account', 60000)).toBe(480); // just under the cap
  });

  it('matches the independent fee models across many charges', () => {
    for (const c of [1, 100, 999, 10000, 62500, 100000, 250000]) {
      expect(stripeFeeCents('card', c)).toBe(cardFee(c));
      expect(stripeFeeCents('us_bank_account', c)).toBe(bankFee(c));
    }
  });
});

describe('grossUpForFee', () => {
  it('card gross-up matches the locked self-pay math', () => {
    // ceil((10000 + 30) / 0.971) = 10330
    expect(grossUpForFee('card', 10000)).toBe(10330);
  });

  it('bank gross-up in the uncapped regime', () => {
    // ceil(10000 / 0.992) = 10081
    expect(grossUpForFee('us_bank_account', 10000)).toBe(10081);
  });

  it('bank gross-up in the capped regime = base + $5', () => {
    expect(grossUpForFee('us_bank_account', 100000)).toBe(100500);
  });

  it('nets at least the base after the real fee, with tiny overshoot, for both methods', () => {
    const methods: PaymentMethodKind[] = ['card', 'us_bank_account'];
    const bases = [1, 30, 500, 8000, 20000, 50000, 62000, 100000, 250000, 99999];
    for (const method of methods) {
      const realFee = method === 'card' ? cardFee : bankFee;
      for (const base of bases) {
        const charge = grossUpForFee(method, base);
        const net = charge - realFee(charge);
        expect(net).toBeGreaterThanOrEqual(base);
        expect(net - base).toBeLessThanOrEqual(2);
      }
    }
  });

  it('zero base charges nothing', () => {
    expect(grossUpForFee('card', 0)).toBe(0);
    expect(grossUpForFee('us_bank_account', 0)).toBe(0);
  });

  it('rejects invalid input', () => {
    expect(() => grossUpForFee('card', -1)).toThrow();
    expect(() => grossUpForFee('card', 10.5)).toThrow();
    expect(() => grossUpForFee('us_bank_account', -5)).toThrow();
  });
});

describe('computeChargeBreakdown', () => {
  it('charges base + fee, where fee is the gross-up overhead (card)', () => {
    const b = computeChargeBreakdown('card', 20000);
    expect(b.baseCents).toBe(20000);
    expect(b.method).toBe('card');
    expect(b.chargeCents).toBe(grossUpForFee('card', 20000));
    expect(b.feeCents).toBe(b.chargeCents - 20000);
  });

  it('bank is cheaper than card for the same base', () => {
    const card = computeChargeBreakdown('card', 30000);
    const bank = computeChargeBreakdown('us_bank_account', 30000);
    expect(bank.feeCents).toBeLessThan(card.feeCents);
  });

  it('platform nets >= base after Stripe takes the real fee', () => {
    for (const method of ['card', 'us_bank_account'] as PaymentMethodKind[]) {
      const realFee = method === 'card' ? cardFee : bankFee;
      const b = computeChargeBreakdown(method, 15000);
      expect(b.chargeCents - realFee(b.chargeCents)).toBeGreaterThanOrEqual(b.baseCents);
    }
  });
});

describe('FEE_SCHEDULES', () => {
  it('encodes US card and ACH pricing', () => {
    expect(FEE_SCHEDULES.card).toEqual({ percent: 0.029, fixedCents: 30, capCents: null });
    expect(FEE_SCHEDULES.us_bank_account).toEqual({ percent: 0.008, fixedCents: 0, capCents: 500 });
  });
});
