import { formatElapsed } from "@/components/redesign/homeowner/home/job-progress-presenters";
import { fmtShortDate, fmtTime, type TodayItem, type TodayItemStatus } from "./overview-types";

// Minimal appointment shape the builder needs. AdminAppointment satisfies it,
// so the wrapper passes real rows; the unit test passes literals.
export interface TodayItemSource {
  id: string;
  status: string;
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time?: string;
  started_at?: string | null;
  cleaner_id?: string | null;
  checklist_id?: string | null;
  service_type_id?: string | null;
}

/**
 * Merge the Overview's `today` and `activeNow` sections into the unified Today
 * card's display rows. The union matters: activeNow is "in_progress regardless
 * of date", so a job still running from a previous day stays visible (with a
 * short date hint in its subtitle) instead of vanishing from the schedule.
 * Pure: the caller supplies the clock and the label functions.
 */
export function buildTodayItems<T extends TodayItemSource>(
  todaySection: T[],
  activeSection: T[],
  opts: {
    todayISO: string; // YYYY-MM-DD in the org's local day
    nowMs: number;
    title: (a: T) => string;
    cleaner: (a: T) => string;
  }
): TodayItem[] {
  const byId = new Map<string, T>();
  for (const a of [...todaySection, ...activeSection]) byId.set(a.id, a);

  const sortKey = (a: T) => `${a.scheduled_date} ${a.scheduled_time ?? ""}`;
  const rows = [...byId.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  return rows.map((a) => {
    // Precedence: live > done > unassigned > upcoming. An in-progress job with
    // no cleaner attached (shouldn't happen, but data drifts) still reads Live.
    const status: TodayItemStatus =
      a.status === "in_progress"
        ? "live"
        : a.status === "completed"
          ? "done"
          : a.cleaner_id == null
            ? "unassigned"
            : "upcoming";

    const cleanerLabel = status === "unassigned" ? "No cleaner yet" : opts.cleaner(a);
    const dateHint = a.scheduled_date !== opts.todayISO ? fmtShortDate(a.scheduled_date) : null;

    return {
      id: a.id,
      time: fmtTime(a.scheduled_time),
      title: opts.title(a),
      subtitle: dateHint ? `${dateHint} · ${cleanerLabel}` : cleanerLabel,
      status,
      ...(status === "live"
        ? {
            elapsed: formatElapsed(a.started_at ?? null, opts.nowMs),
            checklistId: a.checklist_id ?? null,
            serviceTypeId: a.service_type_id ?? null,
          }
        : {}),
    };
  });
}
