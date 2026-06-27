import type { CleanerAppointment } from "@/hooks/useCleanerData";
import type { CleanerPayoutModel, TodayData } from "./today-types";

const byTime = (a: CleanerAppointment, b: CleanerAppointment) =>
  (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");

const isScheduledOn = (a: CleanerAppointment, date: string) =>
  a.scheduled_date === date && (a.status === "confirmed" || a.status === "in_progress");

export function deriveToday(
  appointments: CleanerAppointment[],
  todayStr: string,
  tomorrowStr: string,
  payoutModel: CleanerPayoutModel
): TodayData {
  const activeJob = appointments.find((a) => a.status === "in_progress") ?? null;

  const offers =
    payoutModel === "percentage_contractor"
      ? appointments
          .filter((a) => a.status === "pending" && a.cleaner_confirmation_status === "awaiting")
          .sort(byTime)
      : [];

  const todayJobs = appointments.filter((a) => isScheduledOn(a, todayStr)).sort(byTime);

  const tomorrow = appointments.filter((a) => isScheduledOn(a, tomorrowStr)).sort(byTime);
  const tomorrowCount = tomorrow.length;
  const tomorrowFirstTime = tomorrow[0]?.scheduled_time ?? null;

  const isEmpty = !activeJob && offers.length === 0 && todayJobs.length === 0 && tomorrowCount === 0;

  return { activeJob, offers, todayJobs, tomorrowCount, tomorrowFirstTime, isEmpty };
}
