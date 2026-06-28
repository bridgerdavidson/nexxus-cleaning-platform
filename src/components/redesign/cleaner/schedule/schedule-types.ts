import type { CleanerAppointment } from "@/hooks/useCleanerData";

export type ScheduleView = "upcoming" | "past";
export type ScheduleGroupKey = "today" | "tomorrow" | "this_week" | "later" | "past";
export type ScheduleStatusFilter =
  | "all" | "needs_response" | "confirmed" | "in_progress" | "completed" | "cancelled";

export interface ScheduleGroup {
  key: ScheduleGroupKey;
  label: string;
  jobs: CleanerAppointment[];
}

export interface ScheduleData {
  /** Recent unfinished jobs (pinned above the view toggle); view-independent. */
  needsAttention: CleanerAppointment[];
  groups: ScheduleGroup[];
  /** Count for the active view (excludes needsAttention). */
  total: number;
  /** True when the active view's groups are empty. */
  isEmpty: boolean;
}

export interface DeriveScheduleOptions {
  search: string;
  statusFilter: ScheduleStatusFilter;
  view: ScheduleView;
  todayStr: string;
  tomorrowStr: string;
  weekEndStr: string;
  graceFloorStr: string;
}

/** Status-filter options per view. Scoped so the dropdown never offers a status
 *  the view excludes (e.g. Completed under Upcoming). */
export const SCHEDULE_STATUS_OPTIONS: Record<ScheduleView, { value: ScheduleStatusFilter; label: string }[]> = {
  upcoming: [
    { value: "all", label: "All statuses" },
    { value: "needs_response", label: "Needs response" },
    { value: "confirmed", label: "Upcoming" },
    { value: "in_progress", label: "In progress" },
  ],
  past: [
    { value: "all", label: "All statuses" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
};

/** Status-filter options for a view, dropping the contractor-only
 *  "needs_response" option in the employee model (employees are assigned jobs
 *  by the office, they do not respond to offers). */
export function scheduleStatusOptions(
  view: ScheduleView,
  isEmployee: boolean,
): { value: ScheduleStatusFilter; label: string }[] {
  const opts = SCHEDULE_STATUS_OPTIONS[view];
  return isEmployee ? opts.filter((o) => o.value !== "needs_response") : opts;
}
