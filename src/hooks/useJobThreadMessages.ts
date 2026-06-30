'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { useVisibilityRefetch } from './useVisibilityRefetch';
import { enrichMessages } from './useMessages';
import { MessageWithDetails } from '../types';

interface UseJobThreadMessagesOptions {
  /** The appointment whose homeowner<->cleaner job thread to read. */
  appointmentId: string | null;
  limit?: number;
}

/**
 * Read-only view of a per-appointment homeowner<->cleaner job thread for an
 * OPERATOR (admin/manager). Reads `messages` by `appointment_id` (authorized by
 * the 089 messages_select org-staff policy) without touching the conversation
 * row (operators have no conversations read policy for job threads). No
 * mark-as-read, no compose: the office views these threads but never posts into
 * them. Realtime invalidates on any change to the thread (low volume; simpler
 * and safer than re-implementing useMessages' optimistic append for a view that
 * never sends).
 */
export function useJobThreadMessages({ appointmentId, limit = 30 }: UseJobThreadMessagesOptions) {
  const queryClient = useQueryClient();
  const queryKey = keys.messages.byAppointment(appointmentId ?? '');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [hasMore, setHasMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const query = useQuery({
    queryKey,
    enabled: !!appointmentId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const currentCount = queryClient.getQueryData<MessageWithDetails[]>(queryKey)?.length ?? 0;
      const fetchN = Math.max(limit, currentCount);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('appointment_id', appointmentId as string)
        .order('created_at', { ascending: false })
        .limit(fetchN);

      if (error) throw error;
      if (!data || data.length === 0) {
        setHasMore(false);
        return [] as MessageWithDetails[];
      }
      const enriched = await enrichMessages(data);
      setHasMore(data.length === fetchN);
      return [...enriched].reverse();
    },
  });

  // Realtime: any insert/update on this appointment's messages refetches.
  useSupabaseRealtimeSync({
    channelName: `messages:appointment:${appointmentId ?? ''}`,
    table: 'messages',
    filter: appointmentId ? `appointment_id=eq.${appointmentId}` : undefined,
    enabled: !!appointmentId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  useVisibilityRefetch({ keys: [queryKey], enabled: !!appointmentId });

  const loadMoreMessages = useCallback(async (): Promise<number> => {
    if (!appointmentId || loadingMoreRef.current || !hasMore) return 0;
    const list = queryClient.getQueryData<MessageWithDetails[]>(queryKey) ?? [];
    if (list.length === 0) return 0;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const cursor = list[0].created_at;
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('appointment_id', appointmentId)
        .lt('created_at', cursor)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error || !data || data.length === 0) {
        setHasMore(false);
        return 0;
      }
      const enriched = await enrichMessages(data);
      const older = [...enriched].reverse();
      let added = 0;
      queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev => {
        const existing = prev ?? [];
        const ids = new Set(existing.map(m => m.id));
        const fresh = older.filter(m => !ids.has(m.id));
        added = fresh.length;
        return fresh.length ? [...fresh, ...existing] : existing;
      });
      setHasMore(data.length === limit);
      return added;
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [appointmentId, queryClient, queryKey, limit, hasMore]);

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    hasMore,
    isLoadingMore,
    loadMoreMessages,
    messagesEndRef,
  };
}
