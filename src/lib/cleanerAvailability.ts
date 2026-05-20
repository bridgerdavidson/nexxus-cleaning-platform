import {
  findConflicts,
  findNextAvailableSlot,
  type ScheduleAppointment,
} from './appointmentConflicts';

export interface SlotCandidate {
  date: string;
  time: string;
}

export interface CleanerMetrics {
  acceptanceRate: number | null;
  lastWorkedDaysAgo: number | null;
}

export interface MultiSlotRanking<C extends CleanerLike> {
  cleaner: C;
  score: number;
  slotCoverage: { primary: boolean; alt1: boolean; alt2: boolean };
  acceptanceRate: number | null;
  lastWorkedDaysAgo: number | null;
}

export interface CleanerLike {
  id: string;
  user_profile?: {
    first_name?: string | null;
    last_name?: string | null;
  } | null;
}

export interface CleanerAvailability<C extends CleanerLike> {
  cleaner: C;
  isAvailable: boolean;
  conflicts: ScheduleAppointment[];
  nextFreeSlot: { date: string; time: string } | null;
}

function cleanerSortName(c: CleanerLike): string {
  const first = c.user_profile?.first_name?.trim() ?? '';
  const last = c.user_profile?.last_name?.trim() ?? '';
  return `${first} ${last}`.trim().toLowerCase() || c.id;
}

export function rankCleanersByAvailability<C extends CleanerLike>(
  cleaners: C[],
  schedulesByCleaner: Record<string, ScheduleAppointment[]>,
  candidate: { date: string; time: string; durationMinutes: number } | null,
): CleanerAvailability<C>[] {
  const candidateReady =
    !!candidate &&
    !!candidate.date &&
    !!candidate.time &&
    Number.isFinite(candidate.durationMinutes) &&
    candidate.durationMinutes > 0;

  const results: CleanerAvailability<C>[] = cleaners.map((cleaner) => {
    if (!candidateReady || !candidate) {
      return { cleaner, isAvailable: true, conflicts: [], nextFreeSlot: null };
    }
    const schedule = schedulesByCleaner[cleaner.id] ?? [];
    const conflicts = findConflicts(schedule, candidate);
    const isAvailable = conflicts.length === 0;
    const nextFreeSlot = isAvailable
      ? null
      : findNextAvailableSlot(schedule, candidate);
    return { cleaner, isAvailable, conflicts, nextFreeSlot };
  });

  results.sort((a, b) => {
    if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
    return cleanerSortName(a.cleaner).localeCompare(cleanerSortName(b.cleaner));
  });

  return results;
}

/**
 * Rank cleaners across multiple offered slots for the homeowner-initiated
 * request flow. The primary slot is worth 2 points, each alternate 1 point.
 * Tiebreakers: acceptance rate desc, last-worked-this-property recency,
 * alphabetical (stable).
 *
 * Pure function — caller fetches schedules + metrics once per request and
 * passes them in. Cleaners in `excludeCleanerIds` are dropped from the result
 * (used to skip cleaners who have already declined this appointment in the
 * routing chain).
 */
export function rankCleanersByMultiSlotCoverage<C extends CleanerLike>(
  cleaners: C[],
  schedulesByCleaner: Record<string, ScheduleAppointment[]>,
  slots: SlotCandidate[],
  durationMinutes: number,
  metricsByCleaner: Record<string, CleanerMetrics> = {},
  excludeCleanerIds: string[] = [],
): MultiSlotRanking<C>[] {
  const excluded = new Set(excludeCleanerIds);
  const validSlots = slots.filter((s) => !!s.date && !!s.time);
  const candidates: MultiSlotRanking<C>[] = cleaners
    .filter((c) => !excluded.has(c.id))
    .map((cleaner) => {
      const schedule = schedulesByCleaner[cleaner.id] ?? [];
      const coverage = [false, false, false] as [boolean, boolean, boolean];
      let score = 0;
      validSlots.forEach((slot, i) => {
        if (i > 2) return;
        const conflicts = findConflicts(schedule, {
          date: slot.date,
          time: slot.time,
          durationMinutes,
        });
        const free = conflicts.length === 0;
        coverage[i] = free;
        if (free) score += i === 0 ? 2 : 1;
      });
      const metrics = metricsByCleaner[cleaner.id] ?? {
        acceptanceRate: null,
        lastWorkedDaysAgo: null,
      };
      return {
        cleaner,
        score,
        slotCoverage: {
          primary: coverage[0],
          alt1: coverage[1],
          alt2: coverage[2],
        },
        acceptanceRate: metrics.acceptanceRate,
        lastWorkedDaysAgo: metrics.lastWorkedDaysAgo,
      };
    });

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // Acceptance rate desc; nulls treated as 0 to put unknowns below proven cleaners.
    const ar = a.acceptanceRate ?? 0;
    const br = b.acceptanceRate ?? 0;
    if (ar !== br) return br - ar;
    // last-worked-this-property: smaller daysAgo first; nulls last.
    const al = a.lastWorkedDaysAgo;
    const bl = b.lastWorkedDaysAgo;
    if (al === null && bl !== null) return 1;
    if (bl === null && al !== null) return -1;
    if (al !== null && bl !== null && al !== bl) return al - bl;
    return cleanerSortName(a.cleaner).localeCompare(cleanerSortName(b.cleaner));
  });

  return candidates;
}
