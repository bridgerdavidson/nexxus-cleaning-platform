import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type {
  DeriveScheduleOptions, ScheduleData, ScheduleGroup, ScheduleGroupKey, ScheduleStatusFilter,
} from "./schedule-types";

const keyOf = (a: CleanerAppointment) => `${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`;
const byTimeAsc = (a: CleanerAppointment, b: CleanerAppointment) => keyOf(a).localeCompare(keyOf(b));
const byTimeDesc = (a: CleanerAppointment, b: CleanerAppointment) => -byTimeAsc(a, b);

export function matchesScheduleSearch(a: CleanerAppointment, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const customer = a.homeowner ? `${a.homeowner.first_name ?? ""} ${a.homeowner.last_name ?? ""}` : "";
  const haystack = [a.property?.name, a.property?.address, a.property?.city, a.property?.state, a.service_type?.name, customer]
    .filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

export function matchesScheduleStatus(a: CleanerAppointment, filter: ScheduleStatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "needs_response": return a.status === "pending" && a.cleaner_confirmation_status === "awaiting";
    case "confirmed": return a.status === "confirmed";
    case "in_progress": return a.status === "in_progress";
    case "completed": return a.status === "completed";
    case "cancelled": return a.status === "cancelled";
    default: return true;
  }
}

const isUpcoming = (a: CleanerAppointment) =>
  a.status === "pending" || a.status === "confirmed" || a.status === "in_progress";
const isPast = (a: CleanerAppointment) => a.status === "completed" || a.status === "cancelled";

/** Date-bucket for the upcoming view. Buckets purely by scheduled_date (callers
 * pre-filter to upcoming statuses); past-dated-but-still-active jobs fall under
 * Today so they are never hidden. Always returns one of the four upcoming
 * buckets (never "past", never null). */
export function scheduleGroupOf(
  a: CleanerAppointment, todayStr: string, tomorrowStr: string, weekEndStr: string,
): Exclude<ScheduleGroupKey, "past"> {
  const date = a.scheduled_date ?? "";
  if (date === tomorrowStr) return "tomorrow";
  if (date > tomorrowStr && date <= weekEndStr) return "this_week";
  if (date > weekEndStr) return "later";
  return "today";
}

const GROUP_LABEL: Record<ScheduleGroupKey, string> = {
  today: "Today", tomorrow: "Tomorrow", this_week: "This week", later: "Later", past: "Past",
};

export function deriveSchedule(appointments: CleanerAppointment[], opts: DeriveScheduleOptions): ScheduleData {
  const { search, statusFilter, view, todayStr, tomorrowStr, weekEndStr } = opts;
  const base = appointments.filter(
    (a) => matchesScheduleSearch(a, search) && matchesScheduleStatus(a, statusFilter)
      && (view === "upcoming" ? isUpcoming(a) : isPast(a)),
  );

  if (view === "past") {
    const jobs = [...base].sort(byTimeDesc);
    return { groups: jobs.length ? [{ key: "past", label: GROUP_LABEL.past, jobs }] : [], total: jobs.length, isEmpty: jobs.length === 0 };
  }

  const order: ScheduleGroupKey[] = ["today", "tomorrow", "this_week", "later"];
  const buckets: Record<string, CleanerAppointment[]> = { today: [], tomorrow: [], this_week: [], later: [] };
  for (const a of base) {
    buckets[scheduleGroupOf(a, todayStr, tomorrowStr, weekEndStr)].push(a);
  }
  const groups: ScheduleGroup[] = order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABEL[k], jobs: buckets[k].sort(byTimeAsc) }));
  return { groups, total: base.length, isEmpty: base.length === 0 };
}
