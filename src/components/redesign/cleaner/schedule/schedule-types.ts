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
  groups: ScheduleGroup[];
  total: number;
  isEmpty: boolean;
}

export interface DeriveScheduleOptions {
  search: string;
  statusFilter: ScheduleStatusFilter;
  view: ScheduleView;
  todayStr: string;
  tomorrowStr: string;
  weekEndStr: string;
}
