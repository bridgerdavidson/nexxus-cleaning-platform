'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from './supabase';

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export type SyncBehavior =
  | { type: 'invalidate'; keys: QueryKey[] }
  | { type: 'patch'; key: QueryKey; updater: (old: unknown, payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => unknown }
  | { type: 'append'; key: QueryKey; transform: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => unknown };

export interface UseSupabaseRealtimeSyncOptions {
  channelName: string;
  table: string;
  schema?: string;
  filter?: string;
  events?: RealtimeEvent[];
  enabled?: boolean;
  onEvent: (
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>
  ) => SyncBehavior | SyncBehavior[] | void;
}

export function useSupabaseRealtimeSync({
  channelName,
  table,
  schema = 'public',
  filter,
  events = ['*'],
  enabled = true,
  onEvent,
}: UseSupabaseRealtimeSyncOptions) {
  const queryClient = useQueryClient();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    const channel: RealtimeChannel = supabase.channel(channelName);

    for (const event of events) {
      channel.on(
        // @ts-expect-error supabase-js v2 types accept the literal here
        'postgres_changes',
        { event, schema, table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          const result = onEventRef.current(payload);
          if (!result) return;
          const behaviors: SyncBehavior[] = Array.isArray(result) ? result : [result];
          for (const b of behaviors) {
            if (b.type === 'invalidate') {
              for (const k of b.keys) {
                queryClient.invalidateQueries({ queryKey: k });
              }
            } else if (b.type === 'patch') {
              queryClient.setQueryData(b.key, (old: unknown) => b.updater(old, payload));
            } else if (b.type === 'append') {
              const next = b.transform(payload);
              queryClient.setQueryData(b.key, (old: unknown) => {
                const arr = Array.isArray(old) ? old : [];
                return [...arr, next];
              });
            }
          }
        }
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, channelName, table, schema, filter, events.join(','), queryClient]); // eslint-disable-line react-hooks/exhaustive-deps
}
