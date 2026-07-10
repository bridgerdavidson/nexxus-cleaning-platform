'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { rankCleanersByAvailability, type CleanerLike, type CleanerAvailability } from '@/lib/cleanerAvailability';
import type { ScheduleAppointment } from '@/lib/appointmentConflicts';

export interface RankCandidate {
  date: string;
  time: string;
  durationMinutes: number;
}

/**
 * Rank cleaners by availability for a candidate slot (conflict-ranked, available-first). Fetches the
 * org's pending/confirmed/in-progress appointments on the candidate date, groups them by cleaner, and
 * runs the shared `rankCleanersByAvailability`. When there is no candidate yet, returns every cleaner
 * as neutral/available (in the input order).
 */
export function useRankedCleaners<C extends CleanerLike>(
  cleaners: C[],
  candidate: RankCandidate | null,
  excludeAppointmentId?: string | null,
): CleanerAvailability<C>[] {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? null;
  const date = candidate?.date ?? null;

  const { data: schedulesByCleaner } = useQuery({
    queryKey: ['operator-booking', 'cleaner-schedules', orgId ?? 'none', date ?? 'none', excludeAppointmentId ?? 'none'],
    enabled: !!orgId && !!date,
    queryFn: async (): Promise<Record<string, ScheduleAppointment[]>> => {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, cleaner_id, status, scheduled_date, scheduled_time, duration_minutes')
        .eq('organization_id', orgId as string)
        .eq('scheduled_date', date as string)
        .in('status', ['pending', 'confirmed', 'in_progress']);
      if (error) throw error;
      const grouped: Record<string, ScheduleAppointment[]> = {};
      for (const row of (data ?? []) as Array<ScheduleAppointment & { cleaner_id: string | null }>) {
        if (!row.cleaner_id || row.id === excludeAppointmentId) continue;
        (grouped[row.cleaner_id] ??= []).push(row);
      }
      return grouped;
    },
  });

  return rankCleanersByAvailability(cleaners, schedulesByCleaner ?? {}, candidate);
}
