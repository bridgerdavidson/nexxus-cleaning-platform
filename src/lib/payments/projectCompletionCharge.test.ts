import { describe, it, expect } from 'vitest';
import { projectCompletionCharge } from './projectCompletionCharge';
import { computeChargeBreakdown } from './processingFee';
import { computePaymentSplit } from '../stripe/charges/splits';
import { computeSelfPayAmounts } from './selfPayMath';

describe('projectCompletionCharge', () => {
  it('homeowner-paid card with passthrough ON: charge grossed up, cleaner cut = % of gross (base)', () => {
    const base = 12000, pct = 40, bps = 0;
    const bd = computeChargeBreakdown('card', base);
    const split = computePaymentSplit({ grossCents: base, payoutPercent: pct, platformFeeBps: bps });
    const p = projectCompletionCharge({ baseCents: base, method: 'card', isSelfPay: false, payoutPercent: pct, platformFeeBps: bps, feePassthrough: true });
    expect(p.chargeCents).toBe(bd.chargeCents);
    expect(p.feeCents).toBe(bd.feeCents);
    expect(p.cleanerCutCents).toBe(split.cleanerCents);
    expect(p.isSelfPay).toBe(false);
    expect(p.baseCents).toBe(base);
  });

  it('homeowner-paid card with passthrough OFF: charge = base, zero fee, cleaner cut unchanged', () => {
    const base = 12000, pct = 40, bps = 0;
    const split = computePaymentSplit({ grossCents: base, payoutPercent: pct, platformFeeBps: bps });
    const p = projectCompletionCharge({ baseCents: base, method: 'card', isSelfPay: false, payoutPercent: pct, platformFeeBps: bps, feePassthrough: false });
    expect(p.chargeCents).toBe(base);
    expect(p.feeCents).toBe(0);
    expect(p.cleanerCutCents).toBe(split.cleanerCents);
    expect(p.isSelfPay).toBe(false);
    expect(p.baseCents).toBe(base);
  });

  it('homeowner-paid ACH with passthrough ON uses the bank fee breakdown', () => {
    const base = 12000, pct = 40, bps = 0;
    const bd = computeChargeBreakdown('us_bank_account', base);
    const p = projectCompletionCharge({ baseCents: base, method: 'us_bank_account', isSelfPay: false, payoutPercent: pct, platformFeeBps: bps, feePassthrough: true });
    expect(p.chargeCents).toBe(bd.chargeCents);
    expect(p.feeCents).toBe(bd.feeCents);
    expect(p.method).toBe('us_bank_account');
  });

  it('self-pay always grosses up regardless of feePassthrough', () => {
    const base = 12000, pct = 40;
    const sp = computeSelfPayAmounts({ jobGrossCents: base, payoutPercent: pct, method: 'card' });
    // feePassthrough=false must NOT affect the self-pay branch.
    const p = projectCompletionCharge({ baseCents: base, method: 'card', isSelfPay: true, payoutPercent: pct, platformFeeBps: 0, feePassthrough: false });
    expect(p.cleanerCutCents).toBe(sp.cleanerCutCents);
    expect(p.chargeCents).toBe(sp.chargeCents);
    expect(p.feeCents).toBe(sp.estimatedFeeCents);
    expect(p.isSelfPay).toBe(true);
  });
});
