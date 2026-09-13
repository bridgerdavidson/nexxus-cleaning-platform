import { describe, expect, it } from 'vitest';
import { nextTierFor, seatCapDecision } from './seats';

describe('seatCapDecision', () => {
  it('allows when under the cap', () => {
    expect(seatCapDecision({ seatCap: 5, seatsInUse: 4 })).toEqual({ allowed: true });
  });

  it('refuses at the cap', () => {
    expect(seatCapDecision({ seatCap: 5, seatsInUse: 5 })).toEqual({ allowed: false });
  });

  it('refuses above the cap, which happens after an un-comp', () => {
    expect(seatCapDecision({ seatCap: 15, seatsInUse: 22 })).toEqual({ allowed: false });
  });

  it('never caps a comped org, where the cap is null', () => {
    expect(seatCapDecision({ seatCap: null, seatsInUse: 400 })).toEqual({ allowed: true });
  });
});

describe('nextTierFor', () => {
  it('names the cheapest tier above the current one that fits another seat', () => {
    expect(nextTierFor(5, 'starter')).toBe('Growth');
    expect(nextTierFor(15, 'growth')).toBe('Pro');
  });

  it('returns null when the current tier already fits, because the fix is buying a seat', () => {
    // Starter's ceiling is 5, so at 3 in use they do not need a bigger plan.
    expect(nextTierFor(3, 'starter')).toBeNull();
  });

  it('returns null on Pro, which has no ceiling to outgrow', () => {
    expect(nextTierFor(40, 'pro')).toBeNull();
  });

  it('suggests the smallest tier that fits when there is no plan yet', () => {
    expect(nextTierFor(2, null)).toBe('Starter');
    expect(nextTierFor(9, null)).toBe('Growth');
  });
});
