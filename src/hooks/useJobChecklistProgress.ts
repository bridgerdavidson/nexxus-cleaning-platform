'use client';

import { supabase } from '@/lib/supabase';
import { useOrgQuery } from '@/lib/useOrgQuery';
import { keys } from '@/lib/queryKeys';
import { useSupabaseRealtimeSync } from '@/lib/useSupabaseRealtimeSync';
import { useChecklist } from '@/hooks/useCleanerData';

/**
 * Role-agnostic live view of a job's checklist progress: the task list plus
 * which items are ticked, kept fresh by a realtime subscription on
 * checklist_item_completions. Used by the homeowner's live cleaning card and
 * the operator's Today panel / booking detail sheet; RLS decides what each
 * caller may read (cleaner rw, homeowner via own appointment, org staff via
 * the appointment's organization).
 *
 * The completions query returns the same Set<checklist_line_item_id> shape
 * under the same query key the cleaner's own hook uses, so a device that has
 * both mounted shares one cache entry. (The old homeowner hook cached a bare
 * count under this key, which collided with the cleaner's Set.)
 */
export interface JobChecklistItem {
  id: string;
  task: string;
  position: number | null;
}

export function useJobChecklistProgress({
  appointmentId,
  checklistId,
  serviceTypeId = null,
}: {
  appointmentId: string | null;
  checklistId: string | null;
  /** Fallback for legacy rows without checklist_id (first checklist of the service type). */
  serviceTypeId?: string | null;
}): {
  lineItems: JobChecklistItem[];
  completed: ReadonlySet<string>;
  doneCount: number;
  totalCount: number;
  isLoading: boolean;
} {
  const { lineItems, loading: checklistLoading } = useChecklist({ checklistId, serviceTypeId });

  const completions = useOrgQuery({
    queryKey: keys.appointments.checklistCompletions(appointmentId ?? ''),
    enabled: !!appointmentId,
    queryFn: async ({ signal }): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('checklist_item_completions')
        .select('checklist_line_item_id')
        .eq('appointment_id', appointmentId as string)
        .abortSignal(signal);
      if (error) throw error;
      return new Set((data ?? []).map((r: { checklist_line_item_id: string }) => r.checklist_line_item_id));
    },
  });

  useSupabaseRealtimeSync({
    channelName: `cic:${appointmentId}`,
    table: 'checklist_item_completions',
    filter: appointmentId ? `appointment_id=eq.${appointmentId}` : undefined,
    enabled: !!appointmentId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.appointments.checklistCompletions(appointmentId ?? '')],
    }),
  });

  const completed: ReadonlySet<string> = completions.data ?? EMPTY_SET;
  const doneCount = lineItems.reduce(
    (acc, item) => (completed.has(item.id) ? acc + 1 : acc),
    0,
  );

  return {
    lineItems,
    completed,
    doneCount,
    totalCount: lineItems.length,
    isLoading: checklistLoading || completions.isLoading,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
