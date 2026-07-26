import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { CleanerPayoutModel, TodayData } from "./today-types";
import { isNeedsAttention } from "../shared/zones";

const byTime = (a: CleanerAppointment, b: CleanerAppointment) =>
  (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");

const byTimeDesc = (a: CleanerAppointment, b: CleanerAppointment) =>
  -`${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`.localeCompare(`${b.scheduled_date ?? ""} ${b.scheduled_time ?? ""}`);

/** Minutes since midnight for a "HH:MM[:SS]" time, or NaN when unparseable. */
function startMinutes(time: string | null | undefined): number {
  const [h, m] = (time ?? "").split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/** While a job is in progress, the next job is surfaced below the active card
 *  (for one-tap directions) only when it starts within this many minutes of now,
 *  so a far-off job does not clutter the active view. */
export const NEXT_UP_WHILE_ACTIVE_MINUTES = 180;

export function deriveToday(
  appointments: CleanerAppointment[],
  todayStr: string,
  tomorrowStr: string,
  graceFloorStr: string,
  payoutModel: CleanerPayoutModel,
  nowMinutes?: number
): TodayData {
  // Active = today's (or future) in-progress work only; a stale in_progress is
  // unfinished, not "active".
  const activeJob =
    appointments.find((a) => a.status === "in_progress" && (a.scheduled_date ?? "") >= todayStr) ?? null;

  const needsAttention = appointments
    .filter((a) => isNeedsAttention(a, todayStr, graceFloorStr))
    .sort(byTimeDesc);

  const offers =
    payoutModel !== "hourly_external"
      ? appointments
          .filter((a) => a.status === "pending" && a.cleaner_confirmation_status === "awaiting")
          .sort(byTime)
      : [];

  // Confirmed jobs scheduled exactly today (in_progress is the pinned active job
  // or, if stale, in needsAttention , never double-listed here).
  const todayConfirmed = appointments
    .filter((a) => a.scheduled_date === todayStr && a.status === "confirmed")
    .sort(byTime);

  // "Next up" is the imminent job. With nothing in progress it is pinned at the top
  // (the earliest confirmed job today). While a job IS in progress, the active card
  // leads and Next up sits just below it, but only for a job coming up soon (starting
  // within NEXT_UP_WHILE_ACTIVE_MINUTES of now) so directions are useful, not noise.
  // The surfaced job is pulled out of the list so nothing is double-listed.
  const nextUp = activeJob
    ? nowMinutes == null
      ? null
      : todayConfirmed.find((a) => {
          const delta = startMinutes(a.scheduled_time) - nowMinutes;
          return delta >= 0 && delta <= NEXT_UP_WHILE_ACTIVE_MINUTES;
        }) ?? null
    : todayConfirmed[0] ?? null;
  const todayJobs = todayConfirmed.filter((a) => a.id !== nextUp?.id);

  const tomorrow = appointments
    .filter((a) => a.scheduled_date === tomorrowStr && (a.status === "confirmed" || a.status === "in_progress"))
    .sort(byTime);
  const tomorrowCount = tomorrow.length;
  const tomorrowFirstTime = tomorrow[0]?.scheduled_time ?? null;

  const isEmpty =
    !activeJob && needsAttention.length === 0 && offers.length === 0 && todayConfirmed.length === 0 && tomorrowCount === 0;

  const isEmployee = payoutModel === "hourly_external";

  return { activeJob, nextUp, needsAttention, offers, todayJobs, tomorrowCount, tomorrowFirstTime, isEmpty, isEmployee };
}
