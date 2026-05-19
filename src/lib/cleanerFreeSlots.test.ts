import { describe, it, expect } from 'vitest';
import { deriveFreeSlots, parseTimeToMinutes, type ScheduleConflictBlock } from './cleanerFreeSlots';

const NOW = new Date(2026, 4, 19, 9, 0); // 2026-05-19 09:00 local

describe('parseTimeToMinutes', () => {
  it('parses HH:mm', () => {
    expect(parseTimeToMinutes('09:30')).toBe(9 * 60 + 30);
  });
  it('parses HH:mm:ss', () => {
    expect(parseTimeToMinutes('14:00:00')).toBe(14 * 60);
  });
  it('returns NaN for garbage', () => {
    expect(Number.isNaN(parseTimeToMinutes('garbage'))).toBe(true);
  });
});

describe('deriveFreeSlots', () => {
  const original = { date: '2026-05-20', time: '10:00' };

  it('returns 5 same-time-of-day candidates when cleaner has no conflicts', () => {
    const slots = deriveFreeSlots([], original, { now: NOW, count: 5 });
    expect(slots).toHaveLength(5);
    expect(slots.every((s) => s.time === '10:00')).toBe(true);
    // All distinct dates, all in the future, all within 14 days.
    const dates = new Set(slots.map((s) => s.date));
    expect(dates.size).toBe(5);
  });

  it('skips the original-appointment day', () => {
    const slots = deriveFreeSlots([], original, { now: NOW, count: 14 });
    expect(slots.find((s) => s.date === original.date)).toBeUndefined();
  });

  it('skips days with overlapping appointments', () => {
    const conflicts: ScheduleConflictBlock[] = [
      // Day after original: conflict 9:30-11:00, blocks 10:00-11:00 candidate
      { date: '2026-05-21', time: '09:30', duration_minutes: 90 },
      // Two days after original: conflict 12:00-13:00, does NOT block 10:00-11:00
      { date: '2026-05-22', time: '12:00', duration_minutes: 60 },
    ];
    const slots = deriveFreeSlots(conflicts, original, { now: NOW, count: 5 });
    expect(slots.find((s) => s.date === '2026-05-21')).toBeUndefined();
    expect(slots.find((s) => s.date === '2026-05-22')).toBeDefined();
  });

  it('honors slotDurationMinutes when checking overlap', () => {
    // Conflict at 11:30-12:00, default slot duration 60min: candidate 10:00-11:00 doesn't overlap.
    const conflicts: ScheduleConflictBlock[] = [
      { date: '2026-05-21', time: '11:30', duration_minutes: 30 },
    ];
    const slots = deriveFreeSlots(conflicts, original, { now: NOW, count: 5 });
    expect(slots.find((s) => s.date === '2026-05-21')).toBeDefined();

    // Larger candidate (180min, 10:00-13:00) DOES overlap 11:30-12:00.
    const longSlots = deriveFreeSlots(conflicts, original, {
      now: NOW,
      count: 5,
      slotDurationMinutes: 180,
    });
    expect(longSlots.find((s) => s.date === '2026-05-21')).toBeUndefined();
  });

  it('respects horizonDays', () => {
    const slots = deriveFreeSlots([], original, { now: NOW, count: 20, horizonDays: 3 });
    // Max possible = 3 days, minus the original day (which is day 1 after NOW) = 2.
    expect(slots.length).toBeLessThanOrEqual(3);
  });

  it('returns empty when original.time is unparseable', () => {
    expect(deriveFreeSlots([], { date: '2026-05-20', time: 'oops' }, { now: NOW })).toEqual([]);
  });

  it('returns at most `count` results even with many days free', () => {
    const slots = deriveFreeSlots([], original, { now: NOW, count: 3, horizonDays: 14 });
    expect(slots).toHaveLength(3);
  });

  it('handles exact-edge overlap correctly (back-to-back is not a conflict)', () => {
    // Conflict ends exactly at 10:00 — candidate starts at 10:00 — should NOT block.
    const conflicts: ScheduleConflictBlock[] = [
      { date: '2026-05-21', time: '09:00', duration_minutes: 60 },
    ];
    const slots = deriveFreeSlots(conflicts, original, { now: NOW, count: 5 });
    expect(slots.find((s) => s.date === '2026-05-21')).toBeDefined();
  });
});
