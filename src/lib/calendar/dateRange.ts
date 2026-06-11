/**
 * Local-time date helpers for the calendar grids, built on date-fns so week/month math is
 * DST-safe. Weeks start on Sunday to match the old calendar. Date keys are `yyyy-MM-dd` in
 * local time (mirrors how appointment `scheduled_date` is stored/parsed elsewhere).
 */
import { startOfWeek, startOfMonth, addDays, format } from 'date-fns';
import type { ViewMode } from './types';

const WEEK_OPTS = { weekStartsOn: 0 as const };

/** Local `yyyy-MM-dd` for a Date. */
export function toDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Parse a `yyyy-MM-dd` key into a local Date at midnight (no UTC shift). */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** The 7 days of the week containing `date`, Sunday first. */
export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date, WEEK_OPTS);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** A fixed 6-week (42-cell) month grid containing `date`, Sunday first. */
export function monthMatrix(date: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(date), WEEK_OPTS);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** The day list a given view renders for `date` (day -> single day; week/month -> grids). */
export function gridDaysFor(view: ViewMode, date: Date): Date[] {
  switch (view) {
    case 'month':
      return monthMatrix(date);
    case 'week':
      return weekDays(date);
    case 'day':
      return [date];
    case 'agenda':
    default:
      return [date];
  }
}

/** Local same-calendar-day comparison (ignores time + timezone offset edge cases). */
export function isSameDayLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
