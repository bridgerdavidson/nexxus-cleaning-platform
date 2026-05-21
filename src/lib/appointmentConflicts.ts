/**
 * Pure helper for Wave 3 soft-warn double-booking. Given a cleaner's existing
 * appointments + a candidate (date, time, durationMinutes), returns any
 * pending / confirmed / in_progress appointments that overlap. Cancelled and
 * completed appointments are ignored.
 *
 * Back-to-back appointments (end == start) do NOT count as conflicts.
 */

export interface ScheduleAppointment {
  id: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | string;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  /** Optional — populated by callers that need to surface the conflicting
   *  appointment's homeowner alongside the conflict (e.g. AssignCleanerModal). */
  homeowner_name?: string | null;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

function parseTimeToMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) return NaN;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const ACTIVE_STATUSES = new Set([
  'pending',
  'confirmed',
  'in_progress',
]);

const MINUTES_PER_DAY = 24 * 60;

function formatMinutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Returns the subset of `cleanerAppointments` that overlap with the candidate
 * slot. Excludes the candidate itself when `excludeAppointmentId` is provided
 * (used by edit/reschedule flows so an appointment isn't flagged against itself).
 */
export function findConflicts(
  cleanerAppointments: ScheduleAppointment[],
  candidate: { date: string; time: string; durationMinutes: number },
  options: { excludeAppointmentId?: string } = {},
): ScheduleAppointment[] {
  const startMinutes = parseTimeToMinutes(candidate.time);
  if (!Number.isFinite(startMinutes)) return [];
  if (!candidate.date || !Number.isFinite(candidate.durationMinutes)) return [];
  const endMinutes = startMinutes + candidate.durationMinutes;

  return cleanerAppointments.filter((apt) => {
    if (options.excludeAppointmentId && apt.id === options.excludeAppointmentId) return false;
    if (!ACTIVE_STATUSES.has(apt.status)) return false;
    if (apt.scheduled_date !== candidate.date) return false;
    const otherStart = parseTimeToMinutes(apt.scheduled_time);
    if (!Number.isFinite(otherStart)) return false;
    const otherEnd = otherStart + (apt.duration_minutes || 0);
    return intervalsOverlap(startMinutes, endMinutes, otherStart, otherEnd);
  });
}

/**
 * Returns the earliest same-day start time at or after `candidate.time` where
 * the cleaner can fit a slot of `candidate.durationMinutes` without colliding
 * with any of their active appointments.
 *
 * Walks blocks in order: whenever the cursor + duration fits before the next
 * block, that's the answer; otherwise the cursor jumps to the end of the
 * blocking appointment. Returns null when no slot fits within the day.
 *
 * **Limitation:** does not factor in drive time between properties. Caller
 * should surface this caveat alongside the suggestion.
 */
export function findNextAvailableSlot(
  cleanerAppointments: ScheduleAppointment[],
  candidate: { date: string; time: string; durationMinutes: number },
  options: { excludeAppointmentId?: string } = {},
): { date: string; time: string } | null {
  const startMinutes = parseTimeToMinutes(candidate.time);
  if (!Number.isFinite(startMinutes)) return null;
  if (
    !candidate.date ||
    !Number.isFinite(candidate.durationMinutes) ||
    candidate.durationMinutes <= 0
  ) {
    return null;
  }

  const blocks = cleanerAppointments
    .filter((apt) => {
      if (options.excludeAppointmentId && apt.id === options.excludeAppointmentId) return false;
      if (!ACTIVE_STATUSES.has(apt.status)) return false;
      return apt.scheduled_date === candidate.date;
    })
    .map((apt) => {
      const s = parseTimeToMinutes(apt.scheduled_time);
      return { start: s, end: s + (apt.duration_minutes || 0) };
    })
    .filter((b) => Number.isFinite(b.start))
    .sort((a, b) => a.start - b.start);

  let cursor = startMinutes;
  for (const block of blocks) {
    if (block.end <= cursor) continue; // block ended before our cursor
    if (cursor + candidate.durationMinutes <= block.start) {
      // fits in the gap before this block
      return { date: candidate.date, time: formatMinutesToTime(cursor) };
    }
    // candidate overlaps this block — jump cursor past it
    cursor = block.end;
  }

  // No same-day slot fits within the calendar day
  if (cursor + candidate.durationMinutes > MINUTES_PER_DAY) return null;
  return { date: candidate.date, time: formatMinutesToTime(cursor) };
}
