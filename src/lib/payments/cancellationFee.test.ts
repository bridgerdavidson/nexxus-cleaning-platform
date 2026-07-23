import { describe, it, expect } from 'vitest';
import { computeCancellationFee } from './cancellationFee';

// Local frame: `new Date('YYYY-MM-DDTHH:mm:ss')` (no Z) parses as local time, and so does
// the helper, so building `now` from the same Date keeps the test timezone-independent.
const SCHEDULED_DATE = '2026-06-01';
const SCHEDULED_TIME = '12:00:00';
const scheduledMs = new Date(`${SCHEDULED_DATE}T${SCHEDULED_TIME}`).getTime();
const HOUR = 60 * 60 * 1000;

const base = {
  grossCents: 10000,
  windowHours: 24,
  scheduledDate: SCHEDULED_DATE,
  scheduledTime: SCHEDULED_TIME,
  // Default both policies to "none"; each test sets the one it exercises. This mirrors the DB
  // defaults and keeps tests explicit about which policy they mean.
  feeType: 'none',
  feeValue: 0,
  noShowFeeType: 'none',
  noShowFeeValue: 0,
} as const;

describe('computeCancellationFee', () => {
  it('charges nothing for a cleaner-caused cancellation (even with a no-show fee configured)', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'cleaner',
      noShow: true,
      noShowFeeType: 'flat',
      noShowFeeValue: 50,
      now: scheduledMs - 1 * HOUR, // well inside the window
    });
    expect(feeCents).toBe(0);
  });

  it('charges nothing for an org-initiated cancellation', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'org',
      noShow: true,
      noShowFeeType: 'percent',
      noShowFeeValue: 100,
      now: scheduledMs,
    });
    expect(feeCents).toBe(0);
  });

  it('charges the flat NO-SHOW fee for a homeowner no-show regardless of window', () => {
    const { feeCents, insideWindow } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      noShowFeeType: 'flat',
      noShowFeeValue: 50,
      now: scheduledMs - 100 * HOUR, // far outside the window, but a no-show still bills
    });
    expect(feeCents).toBe(5000);
    expect(insideWindow).toBe(false);
  });

  it('charges a percent of gross for a homeowner late-cancel inside the window', () => {
    const { feeCents, insideWindow } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: false,
      feeType: 'percent',
      feeValue: 20,
      now: scheduledMs - 10 * HOUR, // inside the 24h window
    });
    expect(insideWindow).toBe(true);
    expect(feeCents).toBe(2000); // 20% of $100
  });

  it('charges nothing for an on-time homeowner cancel (outside the window)', () => {
    const { feeCents, insideWindow } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: false,
      feeType: 'percent',
      feeValue: 20,
      now: scheduledMs - 48 * HOUR, // outside the 24h window
    });
    expect(insideWindow).toBe(false);
    expect(feeCents).toBe(0);
  });

  it('charges nothing when the no-show policy is "none"', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      noShowFeeType: 'none',
      noShowFeeValue: 0,
      now: scheduledMs,
    });
    expect(feeCents).toBe(0);
  });

  it('caps a flat no-show fee at the gross amount', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      noShowFeeType: 'flat',
      noShowFeeValue: 200, // $200 flat on a $100 job
      now: scheduledMs,
    });
    expect(feeCents).toBe(10000);
  });

  // ── T1-6: no-show fee is a SEPARATE policy from the late-cancel fee (decision B) ────────────────
  it('T1-6 bug: "free cancels, $50 no-show" charges $50 on a no-show (was silently $0)', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      feeType: 'none', // free cancels
      feeValue: 0,
      noShowFeeType: 'flat', // but a $50 no-show fee
      noShowFeeValue: 50,
      now: scheduledMs,
    });
    expect(feeCents).toBe(5000);
  });

  it('strict independence: a no-show does NOT inherit the late-cancel fee', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      feeType: 'percent', // a 50% late-cancel fee that must NOT apply to a no-show
      feeValue: 50,
      noShowFeeType: 'none', // no-show is free
      noShowFeeValue: 0,
      now: scheduledMs,
    });
    expect(feeCents).toBe(0);
  });

  it('strict independence: a late (inside-window) cancel does NOT inherit the no-show fee', () => {
    const { feeCents, insideWindow } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: false,
      feeType: 'none', // free late cancels
      feeValue: 0,
      noShowFeeType: 'flat', // a $50 no-show fee that must NOT apply to a late cancel
      noShowFeeValue: 50,
      now: scheduledMs - 10 * HOUR, // inside the window
    });
    expect(insideWindow).toBe(true);
    expect(feeCents).toBe(0);
  });
});
