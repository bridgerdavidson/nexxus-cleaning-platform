/**
 * Derive candidate "free" appointment slots for a cleaner to offer as
 * counter-proposal alternatives, given:
 *  - the cleaner's existing appointments (any status the caller deems relevant),
 *  - the original appointment's date+time (used as the same-time-of-day anchor),
 *  - how many candidates to surface as one-tap chips (default 5).
 *
 * Strategy: walk the next 14 calendar days at the original `time` and emit the
 * first `count` days where the cleaner has no overlapping appointment within
 * `slotDurationMinutes`. The original appointment's date itself is skipped (the
 * cleaner already said they're unavailable then). Pure function — no I/O.
 */

export interface ScheduleConflictBlock {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm[:ss]
  duration_minutes: number;
}

export interface FreeSlot {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a "HH:mm" or "HH:mm:ss" string to minutes-since-midnight.
 * Returns NaN if the input doesn't match.
 */
function parseTimeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!m) return NaN;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return NaN;
  return hours * 60 + mins;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns true when [aStart, aEnd) and [bStart, bEnd) overlap on the same day.
 * All inputs are minutes-since-midnight.
 */
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface DeriveFreeSlotsOptions {
  /** Candidate count to return. Default: 5. */
  count?: number;
  /** Days forward to search. Default: 14. */
  horizonDays?: number;
  /** Duration (minutes) the candidate slot should fit. Default: 60. */
  slotDurationMinutes?: number;
  /** Override "now" for deterministic tests. Default: new Date(). */
  now?: Date;
}

/**
 * Walks the next `horizonDays` days at the original appointment's time-of-day
 * and returns up to `count` `{ date, time }` candidates where the cleaner has
 * no overlapping conflict. The original day is skipped.
 */
export function deriveFreeSlots(
  cleanerConflicts: ScheduleConflictBlock[],
  original: { date: string; time: string },
  options: DeriveFreeSlotsOptions = {},
): FreeSlot[] {
  const { count = 5, horizonDays = 14, slotDurationMinutes = 60, now = new Date() } = options;

  const targetMinutes = parseTimeToMinutes(original.time);
  if (!Number.isFinite(targetMinutes)) return [];

  const candidateTime = `${String(Math.floor(targetMinutes / 60)).padStart(2, '0')}:${String(
    targetMinutes % 60,
  ).padStart(2, '0')}`;
  const slotEnd = targetMinutes + slotDurationMinutes;

  // Group existing conflicts by date for O(D + C) lookups instead of O(D × C).
  const conflictsByDate = new Map<string, ScheduleConflictBlock[]>();
  for (const c of cleanerConflicts) {
    const list = conflictsByDate.get(c.date) ?? [];
    list.push(c);
    conflictsByDate.set(c.date, list);
  }

  const results: FreeSlot[] = [];

  // Start tomorrow relative to `now` so we don't suggest a past time today.
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let offset = 1; offset <= horizonDays && results.length < count; offset++) {
    const day = new Date(startDay.getTime() + offset * DAY_MS);
    const dateStr = formatDate(day);

    // Skip the original-appointment day; that's the one the cleaner already
    // declined.
    if (dateStr === original.date) continue;

    const dayConflicts = conflictsByDate.get(dateStr) ?? [];
    const hasOverlap = dayConflicts.some((c) => {
      const cStart = parseTimeToMinutes(c.time);
      if (!Number.isFinite(cStart)) return false;
      const cEnd = cStart + (c.duration_minutes || 0);
      return intervalsOverlap(targetMinutes, slotEnd, cStart, cEnd);
    });
    if (hasOverlap) continue;

    results.push({ date: dateStr, time: candidateTime });
  }

  return results;
}

// Re-export the parseDateLocal helper for callers that want to format the
// resulting `date` strings (kept private otherwise; tests import it directly).
export { parseDateLocal, parseTimeToMinutes };
