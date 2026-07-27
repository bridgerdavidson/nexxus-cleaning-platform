import { describe, it, expect } from 'vitest';
import { agoLabel, marginLine } from './payRequestMath';

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
});
