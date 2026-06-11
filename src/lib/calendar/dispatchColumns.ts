/**
 * Groups events into cleaner columns for the Day dispatch board. Roster order is preserved,
 * cleaners with no jobs still get an (empty) column, an "Unassigned" column is appended when
 * any event has no cleaner, and an event whose cleaner is missing from the roster still gets a
 * trailing column (no event silently vanishes).
 */
import type { CalendarCleaner } from './types';

export interface CleanerColumn<T> {
  /** null = the "Unassigned" bucket. */
  cleaner: CalendarCleaner | null;
  events: T[];
}

export function buildCleanerColumns<T extends { cleanerId: string | null; cleanerName?: string | null }>(
  events: T[],
  cleaners: CalendarCleaner[],
): Array<CleanerColumn<T>> {
  const byCleaner = new Map<string, T[]>();
  const unassigned: T[] = [];

  for (const ev of events) {
    if (ev.cleanerId) {
      const list = byCleaner.get(ev.cleanerId) ?? [];
      list.push(ev);
      byCleaner.set(ev.cleanerId, list);
    } else {
      unassigned.push(ev);
    }
  }

  const columns: Array<CleanerColumn<T>> = cleaners.map((cleaner) => ({
    cleaner,
    events: byCleaner.get(cleaner.id) ?? [],
  }));

  // Events whose cleaner is not in the roster (e.g. a removed cleaner): keep them visible.
  const rosterIds = new Set(cleaners.map((c) => c.id));
  for (const [cleanerId, list] of byCleaner) {
    if (rosterIds.has(cleanerId)) continue;
    columns.push({
      cleaner: { id: cleanerId, name: list[0]?.cleanerName ?? 'Cleaner' },
      events: list,
    });
  }

  if (unassigned.length > 0) {
    columns.push({ cleaner: null, events: unassigned });
  }

  return columns;
}
