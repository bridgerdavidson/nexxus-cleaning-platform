/**
 * Vertical pixel offset for the "now" indicator within a time-grid, or null when
 * the indicator should not render (the focused day is not today, or the current
 * time is outside the visible window). Brand-blue rendering lives in NowIndicator.
 */
import type { BusinessHours } from '@/lib/calendar/types';
import { minutesToY } from '@/lib/calendar/timeGrid';
import { toDateKey } from '@/lib/calendar/dateRange';

export function nowLineY(nowMs: number, focusedDateKey: string, hours: BusinessHours): number | null {
  const now = new Date(nowMs);
  if (toDateKey(now) !== focusedDateKey) return null;
  const min = now.getHours() * 60 + now.getMinutes();
  if (min < hours.startMin || min > hours.endMin) return null;
  return minutesToY(min, hours.startMin);
}
