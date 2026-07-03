import type { Appointment } from '@/hooks/useHomeownerData';
import type { HomeownerStatusTone } from './home-presenters';

export interface HomeownerSeries {
  seriesId: string;
  /** Upcoming occurrences of this series, sorted by (date,time) asc. Length >= 2. */
  occurrences: Appointment[];
  count: number;
  /** occurrences[0]; source of the shared service/property labels. */
  first: Appointment;
  startDate: string;
  endDate: string;
  /** Overall status pill for the grouped card. */
  status: { label: string; tone: HomeownerStatusTone };
}

const UPCOMING_STATUSES = new Set(['pending', 'confirmed', 'in_progress']);

const byDateTime = (a: Appointment, b: Appointment) =>
  `${a.scheduled_date ?? ''} ${a.scheduled_time ?? ''}`.localeCompare(
    `${b.scheduled_date ?? ''} ${b.scheduled_time ?? ''}`,
  );

/**
 * Group the homeowner's UPCOMING recurring cleanings (occurrences sharing a
 * series_id) into one card per series, so an admin-created repeating cleaning
 * shows as a single expandable entry instead of N individual rows. Only series
 * with >= 2 upcoming occurrences are grouped; a standalone cleaning (or a lone
 * remaining occurrence) is left to the normal cleaning surfaces. Terminal
 * (completed / cancelled) and past occurrences are excluded.
 */
export function deriveHomeownerSeries(appointments: Appointment[], todayStr: string): HomeownerSeries[] {
  const groups = new Map<string, Appointment[]>();
  for (const a of appointments) {
    if (!a.series_id) continue;
    if ((a.scheduled_date ?? '') < todayStr) continue;
    if (!UPCOMING_STATUSES.has(a.status)) continue;
    const arr = groups.get(a.series_id);
    if (arr) arr.push(a);
    else groups.set(a.series_id, [a]);
  }

  const series: HomeownerSeries[] = [];
  for (const [seriesId, occ] of groups) {
    if (occ.length < 2) continue;
    const occurrences = [...occ].sort(byDateTime);
    const anyPending = occurrences.some((o) => o.status === 'pending');
    series.push({
      seriesId,
      occurrences,
      count: occurrences.length,
      first: occurrences[0],
      startDate: occurrences[0].scheduled_date,
      endDate: occurrences[occurrences.length - 1].scheduled_date,
      status: anyPending
        ? { label: 'Awaiting confirmation', tone: 'caution' }
        : { label: 'Confirmed', tone: 'secondary' },
    });
  }

  series.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return series;
}
