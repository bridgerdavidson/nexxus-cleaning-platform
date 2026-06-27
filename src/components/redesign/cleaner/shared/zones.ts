import type { CleanerAppointment } from "@/hooks/useCleanerData";

/** Days a never-completed job stays in "Needs attention" before settling into Past. */
export const NEEDS_ATTENTION_DAYS = 3;

const dateOf = (a: CleanerAppointment) => a.scheduled_date ?? "";

/** pending/confirmed/in_progress scheduled today or later. */
export function isUpcomingZone(a: CleanerAppointment, todayStr: string): boolean {
  const s = a.status;
  return (s === "pending" || s === "confirmed" || s === "in_progress") && dateOf(a) >= todayStr;
}

/** A committed job (confirmed or started) whose scheduled day is already past
 * and which never completed/cancelled. */
export function isUnfinished(a: CleanerAppointment, todayStr: string): boolean {
  return (a.status === "confirmed" || a.status === "in_progress") && dateOf(a) < todayStr;
}

/** Recent unfinished work, surfaced in the "Needs attention" zone. */
export function isNeedsAttention(a: CleanerAppointment, todayStr: string, graceFloorStr: string): boolean {
  return isUnfinished(a, todayStr) && dateOf(a) >= graceFloorStr;
}

/** Everything that is neither upcoming nor needs-attention, the Past complement
 * (completed, cancelled, aged-out unfinished, expired past-day offers). */
export function isPastZone(a: CleanerAppointment, todayStr: string, graceFloorStr: string): boolean {
  return !isUpcomingZone(a, todayStr) && !isNeedsAttention(a, todayStr, graceFloorStr);
}
