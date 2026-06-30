// src/lib/messaging/jobMessagingWindow.ts

export interface JobMessagingWindowAppointment {
  status: string;
  /** 'awaiting' | 'approved' | 'rejected' (or null). 'approved' means the
   *  currently-assigned cleaner has committed to the job (set by the cleaner
   *  accepting, accepting a counter-proposal, or an admin force-assign). */
  cleaner_confirmation_status: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the homeowner<->cleaner job thread is open for SENDING.
 *
 * Open while the cleaning is actively happening (`in_progress`), while it is
 * office-confirmed AND the assigned cleaner has accepted (`confirmed` +
 * `cleaner_confirmation_status='approved'`), and for a 24h grace window after
 * completion. Closed while pending or awaiting/rejected cleaner acceptance
 * (so the homeowner cannot message a cleaner who has not committed, including
 * the post-reassignment re-confirm gap), once cancelled, and after the grace
 * window. History stays readable when closed; only sending is gated.
 * (Job-messaging design brief, sections 2 and 3.)
 */
export function isJobMessagingWindowOpen(
  appt: JobMessagingWindowAppointment,
  now: Date,
): boolean {
  if (appt.status === 'cancelled' || appt.cancelled_at) return false;
  // A completed job was necessarily worked; keep the thread open for a short grace.
  if (appt.status === 'completed') {
    return !!appt.completed_at && now.getTime() < new Date(appt.completed_at).getTime() + GRACE_MS;
  }
  // The job is actively happening.
  if (appt.status === 'in_progress') return true;
  // Office-confirmed AND the assigned cleaner has actually accepted.
  if (appt.status === 'confirmed' && appt.cleaner_confirmation_status === 'approved') return true;
  return false;
}
