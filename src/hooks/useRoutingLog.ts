// src/hooks/useRoutingLog.ts
import { supabase } from '@/lib/supabase';
import { keys } from '@/lib/queryKeys';
import { useOrgQuery } from '@/lib/useOrgQuery';
import type { RoutingLogRow } from '@/lib/bookings/routingHistoryVm';

/**
 * Cleaner-dispatch offer trail for one appointment. Client-side read: RLS
 * grants SELECT to the org's owner/admin/manager (migration 059/076).
 * NOTE: appointment_routing_log.cleaner_id has NO foreign key, so no
 * PostgREST embed is possible; callers map ids to names themselves.
 */
export function useRoutingLog(appointmentId: string | null) {
  const query = useOrgQuery({
    queryKey: keys.appointments.routingLog(appointmentId ?? ''),
    enabled: !!appointmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointment_routing_log')
        .select('id, cleaner_id, attempt_index, sent_at, deadline_at, response, responded_at, decline_reason')
        .eq('appointment_id', appointmentId as string)
        .order('attempt_index', { ascending: true });
      if (error) throw error;
      return (data ?? []) as RoutingLogRow[];
    },
  });

  return {
    rows: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: () => void query.refetch(),
  };
}
