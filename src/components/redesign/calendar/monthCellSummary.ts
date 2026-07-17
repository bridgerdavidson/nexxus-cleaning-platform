// src/components/redesign/calendar/monthCellSummary.ts
/**
 * Pure per-day summary for the mobile mini-month grid: 1-3 events render as
 * status-colored dots (start-time order, colors from calendarStatus so the
 * grid speaks the same status vocabulary as the rest of the app), 4+ collapse
 * to a count so slammed days pop at a glance. Also owns the month-change
 * selection rule (today when visible, else the 1st).
 */
import type { CalendarEvent } from '@/lib/calendar/types';
import { toDateKey } from '@/lib/calendar/dateRange';
import { calendarStatus } from './calendarStatus';

export type MonthCellSummary =
  | { kind: 'none' }
  | { kind: 'dots'; dotClasses: string[] }
  | { kind: 'count'; count: number };

export function monthCellSummary(dayEvents: CalendarEvent[], nowMs: number): MonthCellSummary {
  if (dayEvents.length === 0) return { kind: 'none' };
  if (dayEvents.length > 3) return { kind: 'count', count: dayEvents.length };
  const sorted = [...dayEvents].sort((a, b) => a.startMin - b.startMin);
  return { kind: 'dots', dotClasses: sorted.map((e) => calendarStatus(e, nowMs).dotClass) };
}

export function selectionForMonth(monthDate: Date, nowMs: number): string {
  const now = new Date(nowMs);
  if (now.getFullYear() === monthDate.getFullYear() && now.getMonth() === monthDate.getMonth()) {
    return toDateKey(now);
  }
  return toDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
}
