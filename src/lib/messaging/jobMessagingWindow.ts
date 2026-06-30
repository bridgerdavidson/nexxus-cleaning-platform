// src/lib/messaging/jobMessagingWindow.ts

export interface JobMessagingWindowAppointment {
  status: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the homeowner<->cleaner job thread is open for SENDING.
 *
 * Open while the cleaning is actively engaged (confirmed or in progress) and for
 * a 24h grace window after completion. Closed while pending (including the
 * post-reassignment re-confirm gap), once cancelled, and after the grace window.
 * History stays readable when closed; only sending is gated.
 * (Job-messaging design brief, sections 2 and 3.)
 */
export function isJobMessagingWindowOpen(
  appt: JobMessagingWindowAppointment,
  now: Date,
): boolean {
  if (appt.status === 'cancelled' || appt.cancelled_at) return false;
  if (appt.status === 'confirmed' || appt.status === 'in_progress') return true;
  if (appt.status === 'completed' && appt.completed_at) {
    return now.getTime() < new Date(appt.completed_at).getTime() + GRACE_MS;
  }
  return false;
}
