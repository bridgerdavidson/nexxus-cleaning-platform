import { describe, expect, it } from 'vitest';
import { toDateKey } from '@/lib/calendar/dateRange';
import { stepDate } from './useCalendarNavigation';

describe('stepDate', () => {
  const d = new Date(2026, 6, 10); // Fri Jul 10
  it('month steps by whole months', () => {
    expect(toDateKey(stepDate('month', d, 1))).toBe('2026-08-10');
    expect(toDateKey(stepDate('month', d, -1))).toBe('2026-06-10');
  });
  it('week steps by 7 days', () => {
    expect(toDateKey(stepDate('week', d, 1))).toBe('2026-07-17');
  });
  it('day steps by 1 day', () => {
    expect(toDateKey(stepDate('day', d, -1))).toBe('2026-07-09');
  });
  it('agenda steps by 7 days', () => {
    expect(toDateKey(stepDate('agenda', d, 1))).toBe('2026-07-17');
  });
});
