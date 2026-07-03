import type { OccurrenceInput } from '@/lib/appointments/recurrence';
import { formatTimeTo12h } from '@/lib/formatTime';
import type { OperatorBookingState, OperatorRecurrence, CustomRecurrenceType } from './operator-booking-types';
import { isSelfPay } from './deriveOperatorBooking';

const DAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MAX_OCCURRENCES_CAP = 50;
const MAX_HORIZON_MONTHS = 6;

/** Parse a YYYY-MM-DD as a LOCAL date at noon. TZ-safe: avoids the UTC-midnight day-shift so the
 *  produced date strings match the server's UTC generation across US (negative-offset) timezones. */
export function parseYmdLocalNoon(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function weekdayOfYmd(ymd: string): number {
  return parseYmdLocalNoon(ymd).getDay();
}

export function isRecurring(s: OperatorBookingState): boolean {
  return !isSelfPay(s) && s.recurrence.enabled;
}

export function resolveCadence(
  rec: OperatorRecurrence,
  startYmd: string,
): { recurrenceType: CustomRecurrenceType; interval: number; daysOfWeek: number[] | undefined } {
  let recurrenceType: CustomRecurrenceType;
  let interval: number;
  if (rec.preset === 'weekly') {
    recurrenceType = 'weekly';
    interval = 1;
  } else if (rec.preset === 'biweekly') {
    recurrenceType = 'weekly';
    interval = 2;
  } else if (rec.preset === 'every4') {
    recurrenceType = 'weekly';
    interval = 4;
  } else {
    recurrenceType = rec.customType;
    interval = Math.max(1, rec.customInterval);
  }

  if (recurrenceType === 'weekly') {
    const days = rec.daysOfWeek.length > 0 ? [...rec.daysOfWeek].sort((a, b) => a - b) : [weekdayOfYmd(startYmd)];
    return { recurrenceType, interval, daysOfWeek: days };
  }
  return { recurrenceType, interval, daysOfWeek: undefined };
}

export function resolveEnd(rec: OperatorRecurrence): { endDate: string | null; maxOccurrences: number | null } {
  if (rec.end === 'after') return { endDate: null, maxOccurrences: Math.max(1, rec.count) };
  if (rec.end === 'on_date') return { endDate: rec.endDate, maxOccurrences: null };
  return { endDate: null, maxOccurrences: null };
}

export function buildOccurrenceInput(s: OperatorBookingState, durationMinutes: number): OccurrenceInput | null {
  const primary = s.slots[0];
  if (!primary) return null;
  const { recurrenceType, interval, daysOfWeek } = resolveCadence(s.recurrence, primary.date);
  const { endDate, maxOccurrences } = resolveEnd(s.recurrence);
  return {
    startDate: primary.date,
    startTime: primary.time,
    durationMinutes,
    recurrenceType,
    interval,
    daysOfWeek,
    endDate,
    maxOccurrences,
  };
}

function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysLocal(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * TZ-safe client preview of the dates the server will generate. Deliberately mirrors the branch
 * logic of src/lib/appointments/recurrence.ts:generateOccurrences (same caps, same day-stepping)
 * but parses/steps at LOCAL noon so the produced YYYY-MM-DD strings equal the server's UTC output.
 * The shared generator is local-TZ-coupled (UTC-midnight parse + local format) and drifts a day in
 * the Americas, so it cannot be reused directly for a client preview.
 */
export function previewOccurrences(input: OccurrenceInput): string[] {
  const { startDate, recurrenceType, interval, daysOfWeek, endDate, maxOccurrences } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  const start = parseYmdLocalNoon(startDate);
  const hardCap = new Date(start);
  hardCap.setMonth(hardCap.getMonth() + MAX_HORIZON_MONTHS);
  const userEnd = endDate ? parseYmdLocalNoon(endDate) : null;
  const cutoff = userEnd && userEnd < hardCap ? userEnd : hardCap;
  const cap = maxOccurrences ? Math.min(maxOccurrences, MAX_OCCURRENCES_CAP) : MAX_OCCURRENCES_CAP;
  const out: string[] = [];

  if (recurrenceType === 'daily') {
    let cur = start;
    while (cur <= cutoff && out.length < cap) {
      out.push(fmtLocal(cur));
      cur = addDaysLocal(cur, interval);
    }
  } else if (recurrenceType === 'monthly') {
    let cur = start;
    while (cur <= cutoff && out.length < cap) {
      out.push(fmtLocal(cur));
      const x = new Date(cur);
      x.setMonth(x.getMonth() + interval);
      cur = x;
    }
  } else {
    const active = daysOfWeek && daysOfWeek.length > 0 ? [...daysOfWeek].sort((a, b) => a - b) : [start.getDay()];
    let weekStart = start;
    let firstWeek = true;
    while (weekStart <= cutoff && out.length < cap) {
      for (const wd of active) {
        if (out.length >= cap) break;
        const target = addDaysLocal(weekStart, wd - weekStart.getDay());
        if (firstWeek && target < start) continue;
        if (target > cutoff) continue;
        out.push(fmtLocal(target));
      }
      firstWeek = false;
      weekStart = addDaysLocal(weekStart, 7 * interval);
    }
  }
  return out;
}

export function cadencePhrase(rec: OperatorRecurrence, startYmd: string): string {
  const { recurrenceType, interval, daysOfWeek } = resolveCadence(rec, startYmd);
  if (recurrenceType === 'daily') return interval === 1 ? 'Every day' : `Every ${interval} days`;
  if (recurrenceType === 'monthly') return interval === 1 ? 'Every month' : `Every ${interval} months`;
  const every = interval === 1 ? 'Every week' : `Every ${interval} weeks`;
  const days = (daysOfWeek ?? []).map((d) => DAY_PLURAL[d]).join(', ');
  return days ? `${every} on ${days}` : every;
}

function shortDate(ymd: string): string {
  return parseYmdLocalNoon(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** e.g. "Every 2 weeks on Mondays at 10:00 AM. 12 cleanings, Jul 20 to Dec 27." */
export function recurrenceRecap(
  rec: OperatorRecurrence,
  startYmd: string,
  startTime: string,
  dates: string[],
): string {
  const phrase = cadencePhrase(rec, startYmd);
  const at = ` at ${formatTimeTo12h(startTime)}`;
  if (dates.length === 0) return `${phrase}${at}.`;
  const n = dates.length;
  const range = n === 1 ? shortDate(dates[0]) : `${shortDate(dates[0])} to ${shortDate(dates[n - 1])}`;
  return `${phrase}${at}. ${n} cleaning${n === 1 ? '' : 's'}, ${range}.`;
}
