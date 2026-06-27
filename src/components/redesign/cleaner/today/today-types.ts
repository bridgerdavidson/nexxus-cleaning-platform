import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type CleanerPayoutModel = "percentage_contractor" | "hourly_external";

export interface TodayData {
  /** First in-progress job, pinned at the top. */
  activeJob: CleanerAppointment | null;
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
}
