// src/hooks/useRoutingLog.ts
import { supabase } from '@/lib/supabase';
import { keys } from '@/lib/queryKeys';
import { useOrgQuery } from '@/lib/useOrgQuery';
import type { RoutingLogRow } from '@/lib/bookings/routingHistoryVm';

/**
 * Cleaner-dispatch offer trail for one appointment. Client-side read: RLS
 * grants SELECT to the org's owner/admin/manager (migration 059/076).
 *
 * appointment_routing_log.cleaner_id has NO foreign key, so no PostgREST
 * embed is possible. Names are resolved here with a second query against
 * user_profiles (same RLS the admin appointment embeds already rely on);
 * a cleaner whose profile is no longer visible resolves to null and the VM
 * renders the "Former cleaner" fallback. Resolving inside the queryFn keeps
 * rows and names atomic — no flash of wrong names while a separate cleaner
 * list loads.
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
      const rows = data ?? [];
      if (rows.length === 0) return [] as RoutingLogRow[];

      const cleanerIds = [...new Set(rows.map((r) => r.cleaner_id))];
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name')
        .in('id', cleanerIds);
      if (profilesError) throw profilesError;

      const nameById = new Map(
        (profiles ?? []).map((p) => [
          p.id,
          [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
        ]),
      );

      return rows.map((r) => ({
        ...r,
        cleaner_name: nameById.get(r.cleaner_id) ?? null,
      })) as RoutingLogRow[];
    },
  });

  return {
    rows: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: () => void query.refetch(),
  };
}
