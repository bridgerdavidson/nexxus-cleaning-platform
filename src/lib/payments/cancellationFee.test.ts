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
} as const;

describe('computeCancellationFee', () => {
  it('charges nothing for a cleaner-caused cancellation', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'cleaner',
      noShow: true,
      feeType: 'flat',
      feeValue: 50,
      now: scheduledMs - 1 * HOUR, // well inside the window
    });
    expect(feeCents).toBe(0);
  });

  it('charges nothing for an org-initiated cancellation', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'org',
      noShow: true,
      feeType: 'percent',
      feeValue: 100,
      now: scheduledMs,
    });
    expect(feeCents).toBe(0);
  });

  it('charges a flat fee for a homeowner no-show regardless of window', () => {
    const { feeCents, insideWindow } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      feeType: 'flat',
      feeValue: 50,
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

  it('charges nothing when the org policy is "none"', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      feeType: 'none',
      feeValue: 0,
      now: scheduledMs,
    });
    expect(feeCents).toBe(0);
  });

  it('caps a flat fee at the gross amount', () => {
    const { feeCents } = computeCancellationFee({
      ...base,
      party: 'homeowner',
      noShow: true,
      feeType: 'flat',
      feeValue: 200, // $200 flat on a $100 job
      now: scheduledMs,
    });
    expect(feeCents).toBe(10000);
  });
});
