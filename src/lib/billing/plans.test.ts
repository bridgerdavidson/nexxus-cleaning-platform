import { describe, expect, it } from 'vitest';
import {
  EXTRA_SEAT_ANNUAL_CENTS,
  EXTRA_SEAT_MONTHLY_CENTS,
  LOOKUP_KEYS,
  PLANS,
  TRIAL_DAYS,
  TRIAL_SEAT_CAP,
  lookupKeyFor,
  planMonthlyCents,
  seatBounds,
  seatLookupKeyFor,
  tierFor,
} from './plans';

describe('PLANS', () => {
  it('mirrors the locked pricing doc', () => {
    expect(PLANS.starter).toMatchObject({
      name: 'Starter', monthlyCents: 3900, annualMonthlyCents: 2900, includedSeats: 3, maxSeats: 5,
    });
    expect(PLANS.growth).toMatchObject({
      name: 'Growth', monthlyCents: 9900, annualMonthlyCents: 7900, includedSeats: 8, maxSeats: 15,
    });
    expect(PLANS.pro).toMatchObject({
      name: 'Pro', monthlyCents: 16900, annualMonthlyCents: 13900, includedSeats: 15, maxSeats: null,
    });
  });

  it('prices a seat at $10/mo and $120/yr', () => {
    expect(EXTRA_SEAT_MONTHLY_CENTS).toBe(1000);
    expect(EXTRA_SEAT_ANNUAL_CENTS).toBe(12000);
  });

  it('caps the trial at 15 seats for 14 days', () => {
    expect(TRIAL_SEAT_CAP).toBe(15);
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe('planMonthlyCents', () => {
  it('is the base when seats are within the included count', () => {
    expect(planMonthlyCents('starter', 'monthly', 3)).toBe(3900);
    expect(planMonthlyCents('starter', 'monthly', 1)).toBe(3900);
    expect(planMonthlyCents('growth', 'annual', 8)).toBe(7900);
  });

  it('adds a seat price per extra seat', () => {
    expect(planMonthlyCents('starter', 'monthly', 5)).toBe(3900 + 2 * 1000);
    expect(planMonthlyCents('growth', 'monthly', 15)).toBe(9900 + 7 * 1000);
    expect(planMonthlyCents('pro', 'monthly', 20)).toBe(16900 + 5 * 1000);
  });

  it('prices annual extras at the annual seat rate divided across the year', () => {
    // $120/yr is $10/mo of display value, so the monthly-equivalent matches.
    expect(planMonthlyCents('pro', 'annual', 20)).toBe(13900 + 5 * 1000);
  });
});

describe('seatBounds', () => {
  it('runs from the included seats to the hard cap', () => {
    expect(seatBounds('starter')).toEqual({ min: 3, max: 5 });
    expect(seatBounds('growth')).toEqual({ min: 8, max: 15 });
  });

  it('leaves Pro open at the top', () => {
    expect(seatBounds('pro')).toEqual({ min: 15, max: null });
  });
});

describe('lookup keys', () => {
  it('lists all eight', () => {
    expect([...LOOKUP_KEYS].sort()).toEqual([
      'extra_seat_annual', 'extra_seat_monthly',
      'growth_annual', 'growth_monthly',
      'pro_annual', 'pro_monthly',
      'starter_annual', 'starter_monthly',
    ]);
  });

  it('round-trips a tier and period', () => {
    expect(lookupKeyFor('growth', 'annual')).toBe('growth_annual');
    expect(tierFor('growth_annual')).toEqual({ tier: 'growth', period: 'annual' });
    expect(seatLookupKeyFor('annual')).toBe('extra_seat_annual');
  });

  it('returns null for a seat key or an unknown key', () => {
    expect(tierFor('extra_seat_monthly')).toBeNull();
    expect(tierFor('enterprise_monthly')).toBeNull();
  });
});
