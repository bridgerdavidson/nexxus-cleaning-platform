/**
 * Tiered SLA for cleaner response on appointment assignment.
 *
 *   - If the job is starting < 48h away, cleaner has 4 hours to respond.
 *   - Otherwise (>= 48h away), cleaner has 24 hours.
 *
 * Both tiers are computed from "now" at insert/reassign time so the deadline
 * survives realtime updates and admin escalations without a cron job. Once
 * the cleaner has responded (approved/rejected), the route handler should
 * clear the column to NULL so admin queries don't re-flag it overdue.
 */

export const URGENT_TIER_HOURS = 4;
export const STANDARD_TIER_HOURS = 24;
export const URGENT_TIER_THRESHOLD_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

function parseScheduledAt(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const dateParts = date.split('-').map(Number);
  if (dateParts.length !== 3 || dateParts.some((n) => Number.isNaN(n))) return null;
  const [year, month, day] = dateParts;
  const timeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!timeMatch) return null;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

/**
 * @returns the timestamptz the cleaner has to respond by, or null when the
 *   inputs are unparseable (caller should treat as "no deadline").
 */
export function computeResponseDeadline(
  scheduledDate: string,
  scheduledTime: string,
  now: Date = new Date(),
): Date | null {
  const scheduledAt = parseScheduledAt(scheduledDate, scheduledTime);
  if (!scheduledAt) return null;
  const hoursUntilJob = (scheduledAt.getTime() - now.getTime()) / HOUR_MS;
  const tierHours =
    hoursUntilJob < URGENT_TIER_THRESHOLD_HOURS
      ? URGENT_TIER_HOURS
      : STANDARD_TIER_HOURS;
  return new Date(now.getTime() + tierHours * HOUR_MS);
}

/**
 * ISO-8601 string version, convenient for Supabase upserts.
 */
export function computeResponseDeadlineISO(
  scheduledDate: string,
  scheduledTime: string,
  now: Date = new Date(),
): string | null {
  const d = computeResponseDeadline(scheduledDate, scheduledTime, now);
  return d ? d.toISOString() : null;
}
