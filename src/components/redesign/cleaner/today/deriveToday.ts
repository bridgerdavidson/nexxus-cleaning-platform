import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { CleanerPayoutModel, TodayData } from "./today-types";
import { isNeedsAttention } from "../shared/zones";

const byTime = (a: CleanerAppointment, b: CleanerAppointment) =>
  (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");

const byTimeDesc = (a: CleanerAppointment, b: CleanerAppointment) =>
  -`${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`.localeCompare(`${b.scheduled_date ?? ""} ${b.scheduled_time ?? ""}`);

export function deriveToday(
  appointments: CleanerAppointment[],
  todayStr: string,
  tomorrowStr: string,
  graceFloorStr: string,
  payoutModel: CleanerPayoutModel
): TodayData {
  // Active = today's (or future) in-progress work only; a stale in_progress is
  // unfinished, not "active".
  const activeJob =
    appointments.find((a) => a.status === "in_progress" && (a.scheduled_date ?? "") >= todayStr) ?? null;

  const needsAttention = appointments
    .filter((a) => isNeedsAttention(a, todayStr, graceFloorStr))
    .sort(byTimeDesc);

  const offers =
    payoutModel === "percentage_contractor"
      ? appointments
          .filter((a) => a.status === "pending" && a.cleaner_confirmation_status === "awaiting")
          .sort(byTime)
      : [];

  // Confirmed jobs scheduled exactly today (in_progress is the pinned active job
  // or, if stale, in needsAttention , never double-listed here).
  const todayConfirmed = appointments
    .filter((a) => a.scheduled_date === todayStr && a.status === "confirmed")
    .sort(byTime);

  // Lift the most-imminent not-yet-started job into a "Next up" card, but only
  // when nothing is already in progress (the active-job card leads otherwise).
  // The remaining today jobs stay in the list so nothing is double-listed.
  const nextUp = activeJob ? null : todayConfirmed[0] ?? null;
  const todayJobs = nextUp ? todayConfirmed.slice(1) : todayConfirmed;

  const tomorrow = appointments
    .filter((a) => a.scheduled_date === tomorrowStr && (a.status === "confirmed" || a.status === "in_progress"))
    .sort(byTime);
  const tomorrowCount = tomorrow.length;
  const tomorrowFirstTime = tomorrow[0]?.scheduled_time ?? null;

  const isEmpty =
    !activeJob && needsAttention.length === 0 && offers.length === 0 && todayConfirmed.length === 0 && tomorrowCount === 0;

  const isEmployee = payoutModel !== "percentage_contractor";

  return { activeJob, nextUp, needsAttention, offers, todayJobs, tomorrowCount, tomorrowFirstTime, isEmpty, isEmployee };
}
