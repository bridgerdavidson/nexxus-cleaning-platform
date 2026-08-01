import { describe, expect, it } from 'vitest';
import { resolveCleanerShareCents } from './payMode';

describe('resolveCleanerShareCents', () => {
  it('request mode uses the approved amount', () => {
    expect(
      resolveCleanerShareCents({ payoutModel: 'request', payoutPercent: 0, flatRateCents: null, approvedRequestCents: 28000, grossCents: 35000 }),
    ).toEqual({ cents: 28000, capped: false, basis: 'request' });
  });

  it('request mode caps at a refund-shrunk gross and flags it', () => {
    expect(
      resolveCleanerShareCents({ payoutModel: 'request', payoutPercent: 0, flatRateCents: null, approvedRequestCents: 28000, grossCents: 20000 }),
    ).toEqual({ cents: 20000, capped: true, basis: 'request' });
  });

  it('request mode without an approved amount throws (settlement must gate first)', () => {
    expect(() =>
      resolveCleanerShareCents({ payoutModel: 'request', payoutPercent: 0, flatRateCents: null, approvedRequestCents: null, grossCents: 20000 }),
    ).toThrow();
    expect(() =>
      resolveCleanerShareCents({ payoutModel: 'request', payoutPercent: 0, flatRateCents: null, approvedRequestCents: 10.5, grossCents: 20000 }),
    ).toThrow();
  });

  it('flat mode pays the flat rate and caps at gross', () => {
    expect(
      resolveCleanerShareCents({ payoutModel: 'flat', payoutPercent: 0, flatRateCents: 9500, approvedRequestCents: null, grossCents: 18000 }),
    ).toEqual({ cents: 9500, capped: false, basis: 'flat' });
    expect(
      resolveCleanerShareCents({ payoutModel: 'flat', payoutPercent: 0, flatRateCents: 9500, approvedRequestCents: null, grossCents: 8000 }),
    ).toEqual({ cents: 8000, capped: true, basis: 'flat' });
  });

  it('flat mode without a rate throws', () => {
    expect(() =>
      resolveCleanerShareCents({ payoutModel: 'flat', payoutPercent: 0, flatRateCents: null, approvedRequestCents: null, grossCents: 8000 }),
    ).toThrow();
  });

  it('percentage (and the legacy percentage_contractor spelling) floors percent of gross', () => {
    for (const model of ['percentage', 'percentage_contractor', null, undefined]) {
      expect(
        resolveCleanerShareCents({ payoutModel: model, payoutPercent: 60, flatRateCents: null, approvedRequestCents: null, grossCents: 33333 }),
      ).toEqual({ cents: 19999, capped: false, basis: 'percent' });
    }
  });

  it('percentage coerces string percents (numeric columns arrive as text)', () => {
    expect(
      resolveCleanerShareCents({ payoutModel: 'percentage', payoutPercent: '60', flatRateCents: null, approvedRequestCents: null, grossCents: 10000 }),
    ).toEqual({ cents: 6000, capped: false, basis: 'percent' });
  });

  it('hourly_external resolves to zero', () => {
    expect(
      resolveCleanerShareCents({ payoutModel: 'hourly_external', payoutPercent: 60, flatRateCents: 5000, approvedRequestCents: 5000, grossCents: 10000 }),
    ).toEqual({ cents: 0, capped: false, basis: 'none' });
  });

  it('rejects invalid gross or percent', () => {
    expect(() =>
      resolveCleanerShareCents({ payoutModel: 'percentage', payoutPercent: 60, flatRateCents: null, approvedRequestCents: null, grossCents: -1 }),
    ).toThrow();
    expect(() =>
      resolveCleanerShareCents({ payoutModel: 'percentage', payoutPercent: 101, flatRateCents: null, approvedRequestCents: null, grossCents: 100 }),
    ).toThrow();
  });
});
