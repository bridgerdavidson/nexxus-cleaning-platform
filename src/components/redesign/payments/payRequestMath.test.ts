import { describe, it, expect } from 'vitest';
import { agoLabel, marginLine, selfPayChargeEstimateCents } from './payRequestMath';

describe('agoLabel', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime();

  it('buckets by minutes, hours, then days', () => {
    expect(agoLabel('2026-07-27T11:59:30Z', now)).toBe('just now');
    expect(agoLabel('2026-07-27T11:15:00Z', now)).toBe('45m ago');
    expect(agoLabel('2026-07-27T09:00:00Z', now)).toBe('3h ago');
    expect(agoLabel('2026-07-24T12:00:00Z', now)).toBe('3d ago');
  });

  it('treats an unparseable timestamp as just now rather than NaN', () => {
    expect(agoLabel('not-a-date', now)).toBe('just now');
  });
});

describe('marginLine', () => {
  it('positive margin: dollars + percent, positive tone', () => {
    expect(marginLine({ marginCents: 14000, marginPct: 40 })).toEqual({
      text: 'Leaves you $140.00 (40%)',
      tone: 'positive',
    });
  });

  it('zero margin reads caution (approvable but nothing kept)', () => {
    expect(marginLine({ marginCents: 0, marginPct: 0 })).toEqual({
      text: 'Leaves you $0.00 (0%)',
      tone: 'caution',
    });
  });

  it('ask above the job price reads critical with the overage amount', () => {
    expect(marginLine({ marginCents: -2550, marginPct: null })).toEqual({
      text: 'Above job price by $25.50',
      tone: 'critical',
    });
  });

  it('omits the percent when the job price is zero (pct null)', () => {
    expect(marginLine({ marginCents: 500, marginPct: null })).toEqual({
      text: 'Leaves you $5.00',
      tone: 'positive',
    });
  });

  it('company pays: reads as the estimated charge with a neutral tone, never as a margin', () => {
    expect(
      marginLine({ marginCents: -10000, marginPct: null, isSelfPay: true, selfPayChargeCents: 10330 }),
    ).toEqual({
      text: 'Company pays about $103.30 with fees',
      tone: 'neutral',
    });
  });
});

describe('selfPayChargeEstimateCents', () => {
  it('is the amount plus the platform fee on the job price, grossed up for the card fee', () => {
    // $100 ask on a $0 job at 1%: no fee on a $0 gross; ceil((10000 + 30) / 0.971) = 10330.
    expect(selfPayChargeEstimateCents({ jobPriceCents: 0, amountCents: 10000, platformFeeBps: 100 })).toBe(10330);
    // $170 ask on a $300 job at 1%: $3 fee; ceil((17300 + 30) / 0.971) = 17848 (the real prod charge).
    expect(selfPayChargeEstimateCents({ jobPriceCents: 30000, amountCents: 17000, platformFeeBps: 100 })).toBe(17848);
  });

  it('a $0 amount charges nothing', () => {
    expect(selfPayChargeEstimateCents({ jobPriceCents: 30000, amountCents: 0, platformFeeBps: 100 })).toBe(0);
  });
});
