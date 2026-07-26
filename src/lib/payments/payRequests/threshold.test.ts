import { describe, expect, it } from 'vitest';
import { autoApproveMaxCents, isAutoApproved } from './threshold';

describe('autoApproveMaxCents', () => {
  it('floors: $350 job at 20% margin allows up to $280.00', () => {
    expect(autoApproveMaxCents(35000, 2000)).toBe(28000);
  });

  it('floors fractional cents down', () => {
    // 333 * 0.8 = 266.4 -> 266
    expect(autoApproveMaxCents(333, 2000)).toBe(266);
  });

  it('bps 0 auto-approves up to the full price', () => {
    expect(autoApproveMaxCents(35000, 0)).toBe(35000);
  });

  it('bps 10000 auto-approves only $0', () => {
    expect(autoApproveMaxCents(35000, 10000)).toBe(0);
  });

  it('zero-price job allows only $0 at any threshold', () => {
    expect(autoApproveMaxCents(0, 2000)).toBe(0);
  });

  it('rejects non-integer or out-of-range inputs', () => {
    expect(() => autoApproveMaxCents(100.5, 2000)).toThrow();
    expect(() => autoApproveMaxCents(-1, 2000)).toThrow();
    expect(() => autoApproveMaxCents(100, -1)).toThrow();
    expect(() => autoApproveMaxCents(100, 10001)).toThrow();
    expect(() => autoApproveMaxCents(100, 20.5)).toThrow();
  });
});

describe('isAutoApproved', () => {
  it('inclusive boundary: exactly the max approves', () => {
    expect(isAutoApproved(28000, 35000, 2000)).toBe(true);
  });

  it('one cent over the max escalates', () => {
    expect(isAutoApproved(28001, 35000, 2000)).toBe(false);
  });

  it('$0 request always approves, even at bps 10000', () => {
    expect(isAutoApproved(0, 35000, 10000)).toBe(true);
  });

  it('over-price request escalates without throwing (price-leak guard)', () => {
    expect(isAutoApproved(40000, 35000, 2000)).toBe(false);
    expect(isAutoApproved(40000, 35000, 0)).toBe(false);
  });

  it('rejects negative or non-integer request cents', () => {
    expect(() => isAutoApproved(-1, 35000, 2000)).toThrow();
    expect(() => isAutoApproved(10.5, 35000, 2000)).toThrow();
  });
});
