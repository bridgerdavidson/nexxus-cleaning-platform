import { describe, it, expect } from 'vitest';
import { projectCompletionCharge } from './projectCompletionCharge';
import { computeChargeBreakdown } from './processingFee';
import { computePaymentSplit } from '../stripe/charges/splits';
import { computeSelfPayAmounts } from './selfPayMath';

describe('projectCompletionCharge', () => {
  it('homeowner-paid card: charge grossed up, cleaner cut = % of gross (base)', () => {
    const base = 12000, pct = 40, bps = 0;
    const bd = computeChargeBreakdown('card', base);
    const split = computePaymentSplit({ grossCents: base, payoutPercent: pct, platformFeeBps: bps });
    const p = projectCompletionCharge({ baseCents: base, method: 'card', isSelfPay: false, payoutPercent: pct, platformFeeBps: bps });
    expect(p.chargeCents).toBe(bd.chargeCents);
    expect(p.feeCents).toBe(bd.feeCents);
    expect(p.cleanerCutCents).toBe(split.cleanerCents);
    expect(p.isSelfPay).toBe(false);
    expect(p.baseCents).toBe(base);
  });

  it('homeowner-paid ACH uses the bank fee breakdown', () => {
    const base = 12000, pct = 40, bps = 0;
    const bd = computeChargeBreakdown('us_bank_account', base);
    const p = projectCompletionCharge({ baseCents: base, method: 'us_bank_account', isSelfPay: false, payoutPercent: pct, platformFeeBps: bps });
    expect(p.chargeCents).toBe(bd.chargeCents);
    expect(p.method).toBe('us_bank_account');
  });

  it('self-pay delegates to computeSelfPayAmounts', () => {
    const base = 12000, pct = 40;
    const sp = computeSelfPayAmounts({ jobGrossCents: base, payoutPercent: pct, method: 'card' });
    const p = projectCompletionCharge({ baseCents: base, method: 'card', isSelfPay: true, payoutPercent: pct, platformFeeBps: 0 });
    expect(p.cleanerCutCents).toBe(sp.cleanerCutCents);
    expect(p.chargeCents).toBe(sp.chargeCents);
    expect(p.feeCents).toBe(sp.estimatedFeeCents);
    expect(p.isSelfPay).toBe(true);
  });
});
