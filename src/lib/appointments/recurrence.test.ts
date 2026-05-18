import { describe, it, expect } from 'vitest';
import {
  generateOccurrences,
  validateRecurrenceInput,
  type OccurrenceInput,
} from './recurrence';

const base: OccurrenceInput = {
  startDate: '2026-01-01',
  startTime: '09:00',
  durationMinutes: 60,
  recurrenceType: 'daily',
  interval: 1,
};

describe('generateOccurrences', () => {
  it('daily interval=1 caps at MAX_OCCURRENCES_CAP=50 when nothing else limits it', () => {
    const out = generateOccurrences(base);
    expect(out).toHaveLength(50);
    expect(out[0].scheduled_date).toBe('2026-01-01');
    expect(out[0].scheduled_time).toBe('09:00');
    expect(out[0].duration_minutes).toBe(60);
  });

  it('daily honors maxOccurrences when smaller than the cap', () => {
    const out = generateOccurrences({ ...base, maxOccurrences: 10 });
    expect(out).toHaveLength(10);
    expect(out[out.length - 1].scheduled_date).toBe('2026-01-10');
  });

  it('daily honors endDate within the 6-month horizon', () => {
    const out = generateOccurrences({ ...base, endDate: '2026-01-15' });
    expect(out).toHaveLength(15);
    expect(out[0].scheduled_date).toBe('2026-01-01');
    expect(out[14].scheduled_date).toBe('2026-01-15');
  });

  it('clips to the 6-month horizon when endDate is beyond it (without hitting the count cap)', () => {
    const out = generateOccurrences({
      ...base,
      interval: 10,
      endDate: '2027-01-01',
    });
    // Hard horizon: 6 months from 2026-01-01 = 2026-07-01.
    // Every 10 days from Jan 1: Jan 1, 11, 21, 31, Feb 10, 20, Mar 2, 12, 22,
    // Apr 1, 11, 21, May 1, 11, 21, 31, Jun 10, 20, 30 = 19 occurrences (Jul 10 is past cutoff).
    expect(out).toHaveLength(19);
    expect(out[0].scheduled_date).toBe('2026-01-01');
    expect(out[out.length - 1].scheduled_date).toBe('2026-06-30');
  });

  it('weekly with daysOfWeek=[2,4] produces Tue/Thu only', () => {
    // 2026-01-04 is Sunday (weekday=0). Tues/Thurs in week of Jan 4 are Jan 6 and Jan 8.
    const out = generateOccurrences({
      ...base,
      startDate: '2026-01-04',
      recurrenceType: 'weekly',
      daysOfWeek: [2, 4],
      maxOccurrences: 8,
    });
    expect(out).toHaveLength(8);
    expect(out.map((o) => o.scheduled_date)).toEqual([
      '2026-01-06', '2026-01-08',
      '2026-01-13', '2026-01-15',
      '2026-01-20', '2026-01-22',
      '2026-01-27', '2026-01-29',
    ]);
  });

  it('weekly first week skips weekdays before startDate', () => {
    // 2026-01-07 is Wednesday (weekday=3). daysOfWeek=[1,3,5] = Mon, Wed, Fri.
    // Week 1: Mon Jan 5 (skip, before start), Wed Jan 7 (include), Fri Jan 9 (include).
    // Week 2: Mon Jan 12, Wed Jan 14, Fri Jan 16.
    const out = generateOccurrences({
      ...base,
      startDate: '2026-01-07',
      recurrenceType: 'weekly',
      daysOfWeek: [1, 3, 5],
      maxOccurrences: 5,
    });
    expect(out.map((o) => o.scheduled_date)).toEqual([
      '2026-01-07', '2026-01-09',
      '2026-01-12', '2026-01-14', '2026-01-16',
    ]);
  });

  it('monthly handles non-existent days (Jan 31 → Feb 28 in non-leap year)', () => {
    // date-fns addMonths rolls Jan 31 → Feb 28 in 2026 (non-leap).
    const out = generateOccurrences({
      ...base,
      startDate: '2026-01-31',
      recurrenceType: 'monthly',
      maxOccurrences: 3,
    });
    expect(out.map((o) => o.scheduled_date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-28',
    ]);
  });

  it('preserves scheduled_time string verbatim across DST boundary', () => {
    // US DST starts mid-March; ensure the time isn't accidentally TZ-converted.
    const out = generateOccurrences({
      ...base,
      startDate: '2026-03-01',
      startTime: '09:00',
      recurrenceType: 'monthly',
      maxOccurrences: 3,
    });
    expect(out.map((o) => o.scheduled_time)).toEqual(['09:00', '09:00', '09:00']);
  });

  it('returns [] when endDate is before startDate', () => {
    const out = generateOccurrences({
      ...base,
      startDate: '2026-01-15',
      endDate: '2026-01-01',
    });
    expect(out).toHaveLength(0);
  });
});

describe('validateRecurrenceInput', () => {
  it('rejects malformed startDate', () => {
    const result = validateRecurrenceInput({ ...base, startDate: '2026/01/01' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/start date/i);
  });

  it('rejects daysOfWeek values outside 0-6', () => {
    const result = validateRecurrenceInput({
      ...base,
      recurrenceType: 'weekly',
      daysOfWeek: [0, 7],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/days of week/i);
  });

  it('accepts a well-formed input', () => {
    expect(validateRecurrenceInput(base).valid).toBe(true);
  });
});
