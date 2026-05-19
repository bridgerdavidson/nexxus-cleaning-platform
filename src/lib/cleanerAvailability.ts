import {
  findConflicts,
  findNextAvailableSlot,
  type ScheduleAppointment,
} from './appointmentConflicts';

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
