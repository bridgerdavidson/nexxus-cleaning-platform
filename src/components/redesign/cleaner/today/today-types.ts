import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type CleanerPayoutModel = "percentage_contractor" | "hourly_external";

export interface TodayData {
  /** First in-progress job scheduled today or later, pinned at the top. */
  activeJob: CleanerAppointment | null;
  /** The single most-imminent not-yet-started confirmed job for today, lifted
   *  out of todayJobs into a prominent "Next up" card with one-tap Start +
   *  Directions. Null when a job is already active (the active card leads) or
   *  nothing is confirmed for today. */
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
