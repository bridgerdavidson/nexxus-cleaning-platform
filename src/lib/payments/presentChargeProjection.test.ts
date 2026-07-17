import { describe, it, expect } from 'vitest';
import { presentChargeProjection } from './presentChargeProjection';
import type { FullChargeBreakdown } from './projectCompletionCharge';

const full: FullChargeBreakdown = {
  baseCents: 12000,
  method: 'card',
  chargeCents: 12500,
  feeCents: 500,
  cleanerCutCents: 4800,
  platformFeeCents: 120,
  payoutPercent: 40,
  isSelfPay: false,
};

describe('presentChargeProjection', () => {
  it('payout_only + cleaner viewer: omits customer charge AND percentage', () => {
    const p = presentChargeProjection(full, { display: 'payout_only', isCleanerViewer: true });
    expect(p.display).toBe('payout_only');
    expect(p.cleanerCutCents).toBe(full.cleanerCutCents);
    expect(p.isSelfPay).toBe(false);
    // Privacy: none of the fields that reveal the customer charge are present.
    expect(p.chargeCents).toBeUndefined();
    expect(p.feeCents).toBeUndefined();
    expect(p.baseCents).toBeUndefined();
    expect(p.method).toBeUndefined();
    expect(p.payoutPercent).toBeUndefined();
    // The platform fee is derived from the job gross, so it is redacted with the rest.
    expect(p.platformFeeCents).toBeUndefined();
  });

  it('payout_only + org staff viewer (not cleaner): returns the full breakdown', () => {
    const p = presentChargeProjection(full, { display: 'payout_only', isCleanerViewer: false });
    expect(p.display).toBe('full');
    expect(p.cleanerCutCents).toBe(full.cleanerCutCents);
    expect(p.baseCents).toBe(full.baseCents);
    expect(p.method).toBe('card');
    expect(p.chargeCents).toBe(full.chargeCents);
    expect(p.feeCents).toBe(full.feeCents);
    expect(p.platformFeeCents).toBe(full.platformFeeCents);
    expect(p.payoutPercent).toBe(full.payoutPercent);
    expect(p.isSelfPay).toBe(false);
  });

  it("display 'full' returns the full breakdown for a cleaner viewer", () => {
    const p = presentChargeProjection(full, { display: 'full', isCleanerViewer: true });
    expect(p.display).toBe('full');
    expect(p.chargeCents).toBe(full.chargeCents);
    expect(p.feeCents).toBe(full.feeCents);
    expect(p.baseCents).toBe(full.baseCents);
    expect(p.method).toBe('card');
    expect(p.payoutPercent).toBe(full.payoutPercent);
    expect(p.cleanerCutCents).toBe(full.cleanerCutCents);
  });

  it("display 'full' returns the full breakdown for an org-staff viewer", () => {
    const p = presentChargeProjection(full, { display: 'full', isCleanerViewer: false });
    expect(p.display).toBe('full');
    expect(p.chargeCents).toBe(full.chargeCents);
    expect(p.payoutPercent).toBe(full.payoutPercent);
  });
});
