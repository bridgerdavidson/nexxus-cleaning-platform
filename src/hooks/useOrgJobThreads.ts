'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { useVisibilityRefetch } from './useVisibilityRefetch';

export interface JobThreadSummary {
  appointmentId: string;
  conversationId: string;
  lastMessageContent: string;
  lastMessageAt: string;
  unreadCount: number;
}

// Cap: reduce the most recent N job messages to per-appointment threads. Job
// threads are low-volume; a thread whose latest activity is older than this
// window won't list here (the booking-detail panel from 2a is the complete
// per-job view). Logged, not silent, if the cap is hit.
const MESSAGE_WINDOW = 500;

/**
 * List the org's homeowner<->cleaner JOB threads for the operator console
 * (read-only). Reduces `messages` (org-scoped, appointment_id NOT NULL,
 * authorized by the 089 org-staff messages_select policy) to one summary per
 * appointment. No conversations read (job threads have no org-staff conversations
 * policy) and no new migration.
 */
export function useOrgJobThreads({ orgId, userId }: { orgId: string; userId: string }) {
  const queryKey = keys.jobThreads.byOrg(orgId);

  const query = useQuery({
    queryKey,
    enabled: !!orgId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, appointment_id, content, created_at, recipient_id, is_read')
        .eq('organization_id', orgId)
        .not('appointment_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_WINDOW);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === MESSAGE_WINDOW) {
        // eslint-disable-next-line no-console
        console.warn(
          `[useOrgJobThreads] hit the ${MESSAGE_WINDOW}-message window; older job threads may be omitted.`,
        );
      }

      const byAppt = new Map<string, JobThreadSummary>();
      const unread = new Map<string, number>();
      for (const m of rows) {
        const apptId = m.appointment_id as string;
        // rows are newest-first, so the first seen per appointment is the latest.
        if (!byAppt.has(apptId)) {
          byAppt.set(apptId, {
            appointmentId: apptId,
            conversationId: m.conversation_id as string,
            lastMessageContent: (m.content as string) ?? '',
            lastMessageAt: m.created_at as string,
            unreadCount: 0,
          });
        }
        if (m.recipient_id === userId && m.is_read === false) {
          unread.set(apptId, (unread.get(apptId) ?? 0) + 1);
        }
      }
      const summaries = Array.from(byAppt.values()).map(s => ({
        ...s,
        unreadCount: unread.get(s.appointmentId) ?? 0,
      }));
      summaries.sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
      );
      return summaries;
    },
  });

  // Realtime: any org message change may add/reorder a job thread. Distinct
  // channel name from 1b's org-office message channel (dedup hinges on the name).
  useSupabaseRealtimeSync({
    channelName: `messages:org:${orgId}:job-threads`,
    table: 'messages',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  useVisibilityRefetch({ keys: [queryKey], enabled: !!orgId });

  const jobThreads = useMemo(() => query.data ?? [], [query.data]);
  return { jobThreads, loading: query.isLoading, error: query.error?.message ?? null };
}
