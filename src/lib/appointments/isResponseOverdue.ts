/**
 * The Overview "Response overdue" predicate (R10): a pending, cleaner-assigned
 * booking whose asked cleaner blew the response deadline with no answer. Kept
 * as one shared helper so the Overview queue and the calendar's Overdue badge
 * always agree. Distinct from (and stricter than) the legacy
 * `src/lib/isAppointmentOverdue.ts`, which also flags confirmed/in_progress
 * rows; this one is pending-only by design.
 */
export interface OverdueInput {
  status: string;
  cleaner_id?: string | null;
  cleaner_confirmation_status?: string | null;
  response_deadline?: string | null;
}

export function isResponseOverdue(appt: OverdueInput, nowMs: number): boolean {
  return (
    appt.status === 'pending' &&
    appt.cleaner_id != null &&
    appt.cleaner_confirmation_status === 'awaiting' &&
    !!appt.response_deadline &&
    Date.parse(appt.response_deadline) < nowMs
  );
}
