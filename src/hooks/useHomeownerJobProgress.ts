'use client';

import { supabase } from '@/lib/supabase';
import { useOrgQuery } from '@/lib/useOrgQuery';
import { keys } from '@/lib/queryKeys';
import { useSupabaseRealtimeSync } from '@/lib/useSupabaseRealtimeSync';

/**
 * Read-only hook for a homeowner watching their cleaning live.
 * Returns the count of completed checklist items for the appointment and the
 * total number of items in the checklist, so the UI can render a progress bar.
 * Subscribes to realtime changes on checklist_item_completions so the counts
 * update automatically as the cleaner ticks off tasks.
 */
export function useHomeownerJobProgress(
  appointmentId: string | null,
  checklistId: string | null,
): { doneCount: number; totalCount: number; isLoading: boolean } {
  const completions = useOrgQuery({
    queryKey: keys.appointments.checklistCompletions(appointmentId ?? ''),
    enabled: !!appointmentId,
    queryFn: async ({ signal }) => {
      const { count, error } = await supabase
        .from('checklist_item_completions')
        .select('id', { count: 'exact', head: true })
        .eq('appointment_id', appointmentId as string)
        .abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const total = useOrgQuery({
    queryKey: keys.appointments.checklistTotal(checklistId ?? ''),
    enabled: !!checklistId,
    queryFn: async ({ signal }) => {
      const { count, error } = await supabase
        .from('checklist_line_items')
        .select('id', { count: 'exact', head: true })
        .eq('checklist_id', checklistId as string)
        .abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useSupabaseRealtimeSync({
    channelName: `cic:homeowner:${appointmentId}`,
    table: 'checklist_item_completions',
    filter: appointmentId ? `appointment_id=eq.${appointmentId}` : undefined,
    enabled: !!appointmentId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.appointments.checklistCompletions(appointmentId ?? '')],
    }),
  });

  return {
    doneCount: completions.data ?? 0,
    totalCount: total.data ?? 0,
    isLoading: completions.isLoading || total.isLoading,
  };
}
