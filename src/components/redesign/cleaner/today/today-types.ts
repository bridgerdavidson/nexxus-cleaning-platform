import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type CleanerPayoutModel = "percentage_contractor" | "hourly_external";

export interface TodayData {
  /** First in-progress job scheduled today or later, pinned at the top. */
  activeJob: CleanerAppointment | null;
  /** The imminent job, lifted out of todayJobs into a prominent "Next up" card
   *  with one-tap Start + Directions. Pinned at the top when nothing is in
   *  progress; while a job IS active it sits just below the active card, but only
   *  for a job starting soon (see NEXT_UP_WHILE_ACTIVE_MINUTES). Null when nothing
   *  qualifies. */
  nextUp: CleanerAppointment | null;
  /** Recent unfinished jobs (past-day, never completed) needing the cleaner's
   *  attention. Surfaced near the top so they are not lost. */
  needsAttention: CleanerAppointment[];
  /** Pending offers awaiting the cleaner's response. Always empty in the
   *  employee (hourly_external) model, where jobs are assigned, not offered. */
  offers: CleanerAppointment[];
  /** Confirmed or in-progress jobs scheduled for today, sorted by time. */
  todayJobs: CleanerAppointment[];
  /** Count of confirmed/in-progress jobs scheduled for tomorrow. */
  tomorrowCount: number;
  /** Earliest scheduled_time among tomorrow's jobs, or null. */
  tomorrowFirstTime: string | null;
  /** True when there is nothing to show (drives the empty state). */
  isEmpty: boolean;
  /** True in the employee (hourly_external) model: jobs are assigned by the
   *  office, not offered. Drives the "assigned by your office" framing. */
  isEmployee: boolean;
}
