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
