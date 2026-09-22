import { describe, expect, it } from 'vitest';
import { parsePlanSelection, seatBoundsError, seatsInUseError } from './planSelection';

describe('parsePlanSelection', () => {
  it('accepts a well-formed triple', () => {
    const result = parsePlanSelection({ tier: 'growth', period: 'annual', seat_count: 10 });
    expect(result).toEqual({ ok: true, selection: { tier: 'growth', period: 'annual', seatCount: 10 } });
  });

  it.each([
    [{ tier: 'enterprise', period: 'monthly', seat_count: 3 }, /tier/i],
    [{ tier: 'starter', period: 'weekly', seat_count: 3 }, /period/i],
    [{ tier: 'starter', period: 'monthly', seat_count: 3.5 }, /whole number/i],
    [{ tier: 'starter', period: 'monthly', seat_count: '3' }, /whole number/i],
    [{ period: 'monthly', seat_count: 3 }, /tier/i],
  ])('rejects %j', (body, message) => {
    const result = parsePlanSelection(body as Record<string, unknown>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message as RegExp);
  });

  it('rejects a null body rather than throwing', () => {
    expect(parsePlanSelection(null).ok).toBe(false);
  });

  // Bounds are a separate step so they can run AFTER the auth check.
  it('does not police seat bounds', () => {
    expect(parsePlanSelection({ tier: 'starter', period: 'monthly', seat_count: 99 }).ok).toBe(true);
  });
});

describe('seatBoundsError', () => {
  it('passes a count inside the tier range', () => {
    expect(seatBoundsError('starter', 3)).toBeNull();
    expect(seatBoundsError('starter', 5)).toBeNull();
  });

  it('names the minimum when the count is below it', () => {
    expect(seatBoundsError('starter', 2)).toMatch(/at least 3/);
    expect(seatBoundsError('growth', 7)).toMatch(/at least 8/);
  });

  it('names the maximum when the count is above it', () => {
    expect(seatBoundsError('starter', 6)).toMatch(/at most 5/);
    expect(seatBoundsError('growth', 16)).toMatch(/at most 15/);
  });

  it('treats Pro as uncapped', () => {
    expect(seatBoundsError('pro', 500)).toBeNull();
  });
});

describe('seatsInUseError', () => {
  it('allows buying exactly the seats in use, or more', () => {
    expect(seatsInUseError(4, 4)).toBeNull();
    expect(seatsInUseError(9, 4)).toBeNull();
  });

  it('refuses buying fewer than are in use, and says how many', () => {
    expect(seatsInUseError(3, 4)).toMatch(/You have 4 cleaners/);
  });
});
