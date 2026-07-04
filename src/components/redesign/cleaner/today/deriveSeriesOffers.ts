import type { CleanerAppointment } from "@/hooks/useCleanerData";

export interface SeriesOffer {
  seriesId: string;
  /** Occurrences of this series still awaiting the cleaner, sorted by (date,time) asc. Length >= 2. */
  occurrences: CleanerAppointment[];
  count: number;
  /** occurrences[0]; source of the shared property/service/customer labels. */
  first: CleanerAppointment;
  /** Soonest non-null response_deadline (ISO) across occurrences, or null. */
  soonestDeadline: string | null;
  startDate: string;
  endDate: string;
}

export interface GroupedOffers {
  singles: CleanerAppointment[];
  series: SeriesOffer[];
}

const byDateTime = (a: CleanerAppointment, b: CleanerAppointment) =>
  `${a.scheduled_date ?? ""} ${a.scheduled_time ?? ""}`.localeCompare(
    `${b.scheduled_date ?? ""} ${b.scheduled_time ?? ""}`,
  );

/**
 * Group a flat list of pending offers (the cleaner's `awaiting` appointments) into
 * standalone singles + recurring series. A series shows as one grouped offer only
 * when >= 2 of its occurrences are still awaiting; a lone remaining occurrence
 * degrades to a single (no "series of 1"). Occurrences and singles are date-sorted;
 * series are ordered by their soonest occurrence.
 */
export function deriveSeriesOffers(offers: CleanerAppointment[]): GroupedOffers {
  const singles: CleanerAppointment[] = [];
  const groups = new Map<string, CleanerAppointment[]>();

  for (const o of offers) {
    const sid = o.series_id;
    if (!sid) {
      singles.push(o);
      continue;
    }
    const arr = groups.get(sid);
    if (arr) arr.push(o);
    else groups.set(sid, [o]);
  }

  const series: SeriesOffer[] = [];
  for (const [seriesId, occ] of groups) {
    if (occ.length < 2) {
      // Lone remaining occurrence: treat as a single offer.
      singles.push(occ[0]);
      continue;
    }
    const occurrences = [...occ].sort(byDateTime);
    const deadlines = occurrences
      .map((o) => o.response_deadline)
      .filter((d): d is string => !!d)
      .sort();
    series.push({
      seriesId,
      occurrences,
      count: occurrences.length,
      first: occurrences[0],
      soonestDeadline: deadlines[0] ?? null,
      startDate: occurrences[0].scheduled_date,
      endDate: occurrences[occurrences.length - 1].scheduled_date,
    });
  }

  singles.sort(byDateTime);
  series.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { singles, series };
}
