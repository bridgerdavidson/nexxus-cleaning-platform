import { describe, it, expect } from 'vitest';
import { toDateKey, fromDateKey, weekDays, monthMatrix, isSameDayLocal } from './dateRange';

describe('dateRange', () => {
  it('round-trips a date key without UTC shift', () => {
    const d = new Date(2026, 5, 10); // 2026-06-10 local
    expect(toDateKey(d)).toBe('2026-06-10');
    expect(isSameDayLocal(fromDateKey('2026-06-10'), d)).toBe(true);
  });

  it('builds a 7-day week starting Sunday', () => {
    const week = weekDays(new Date(2026, 5, 10)); // Wed Jun 10 2026
    expect(week).toHaveLength(7);
    expect(week[0].getDay()).toBe(0); // Sunday
    expect(toDateKey(week[0])).toBe('2026-06-07');
    expect(toDateKey(week[6])).toBe('2026-06-13');
  });

  it('builds a 42-cell month grid with leading/trailing days', () => {
    const grid = monthMatrix(new Date(2026, 5, 1)); // June 2026
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(0);
    // June 1 2026 is a Monday, so the grid starts on the prior Sunday (May 31).
    expect(toDateKey(grid[0])).toBe('2026-05-31');
  });

  it('keeps 7 consecutive distinct days across a US spring-forward boundary', () => {
    const week = weekDays(new Date(2026, 2, 10)); // week of Tue Mar 10 2026 (DST Mar 8)
    const keys = week.map(toDateKey);
    expect(new Set(keys).size).toBe(7);
    expect(keys).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
    ]);
  });

  it('weekDays with weekStartsOn=1 starts on Monday', () => {
    // 2026-07-10 is a Friday; the Monday-start week begins 2026-07-06.
    const days = weekDays(new Date(2026, 6, 10), 1);
    expect(toDateKey(days[0])).toBe('2026-07-06');
    expect(toDateKey(days[6])).toBe('2026-07-12');
  });
  it('monthMatrix with weekStartsOn=1 begins on a Monday', () => {
    const cells = monthMatrix(new Date(2026, 6, 10), 1);
    expect(cells[0].getDay()).toBe(1); // Monday
    expect(cells).toHaveLength(42);
  });
});
