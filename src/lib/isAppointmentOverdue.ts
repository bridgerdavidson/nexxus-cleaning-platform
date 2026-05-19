/**
 * Derives the "overdue" boolean for an appointment without any cron / scheduled
 * job. An appointment is overdue when the cleaner hasn't responded yet AND the
 * SLA deadline has passed.
 *
 *   overdue = response_deadline < now AND cleaner_confirmation_status === 'awaiting'
 *
 * Already-approved or already-rejected (counter-proposed / declined)
 * appointments are NOT overdue — the SLA stops once the cleaner responds.
 * Cancelled appointments are likewise not overdue.
 */

export interface OverdueAppointment {
  status?: string | null;
  cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected' | null;
  response_deadline?: string | Date | null;
}

export function isAppointmentOverdue(
  appointment: OverdueAppointment,
  now: Date = new Date(),
): boolean {
  if (appointment.cleaner_confirmation_status !== 'awaiting') return false;
  if (appointment.status === 'cancelled' || appointment.status === 'completed') {
    return false;
  }
  const deadline = appointment.response_deadline;
  if (!deadline) return false;
  const deadlineMs =
    typeof deadline === 'string' ? Date.parse(deadline) : deadline.getTime();
  if (Number.isNaN(deadlineMs)) return false;
  return deadlineMs < now.getTime();
}

/**
 * Same predicate but for the "almost overdue" countdown surface on the cleaner
 * side. Returns a coarse urgency band so the badge can switch colors:
 *
 *   'overdue'   — deadline already passed
 *   'urgent'    — < 10% of original SLA window remaining
 *   'soon'      — 10–50% remaining
 *   'plenty'    — > 50% remaining
 *   null        — no deadline, or cleaner has already responded
 *
 * Callers pass the issued-at time (when the deadline was set) so the band can
 * be relative to the original SLA window rather than absolute clock time.
 */
export type DeadlineUrgency = 'plenty' | 'soon' | 'urgent' | 'overdue';

export function deadlineUrgency(
  appointment: OverdueAppointment,
  issuedAt: Date | string | null | undefined,
  now: Date = new Date(),
): DeadlineUrgency | null {
  if (appointment.cleaner_confirmation_status !== 'awaiting') return null;
  if (appointment.status === 'cancelled' || appointment.status === 'completed') {
    return null;
  }
  const deadline = appointment.response_deadline;
  if (!deadline) return null;
  const deadlineMs =
    typeof deadline === 'string' ? Date.parse(deadline) : deadline.getTime();
  if (Number.isNaN(deadlineMs)) return null;

  const nowMs = now.getTime();
  if (deadlineMs <= nowMs) return 'overdue';

  if (!issuedAt) {
    // Fall back to a heuristic — anything <1h out is urgent.
    const remainingMs = deadlineMs - nowMs;
    if (remainingMs < 60 * 60 * 1000) return 'urgent';
    return 'soon';
  }
  const issuedMs =
    typeof issuedAt === 'string' ? Date.parse(issuedAt) : issuedAt.getTime();
  if (Number.isNaN(issuedMs)) return 'soon';
  const total = Math.max(1, deadlineMs - issuedMs);
  const remaining = deadlineMs - nowMs;
  const ratio = remaining / total;
  if (ratio < 0.1) return 'urgent';
  if (ratio < 0.5) return 'soon';
  return 'plenty';
}
