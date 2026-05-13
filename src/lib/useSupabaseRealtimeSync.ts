'use client';

import { useEffect, useId, useRef } from 'react';
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

  // supabase.channel(topic) returns the EXISTING channel if the topic matches,
  // which means two hooks with the same `channelName` end up sharing one
  // RealtimeChannel — both .on() bindings pile onto the same channel and the
  // first hook to unmount calls removeChannel and kills it for the other one.
  // Combined with React Strict Mode (mount → cleanup → re-mount in dev), this
  // duplicates bindings and the next rejoin throws "mismatch between server
  // and client bindings for postgres changes".
  //
  // useId() gives each hook instance a stable unique suffix, so the underlying
  // realtime topic is always unique per hook. We keep `channelName` as a
  // human-readable label baked into the topic for log readability.
  const instanceId = useId();
  const topic = `${channelName}#${instanceId}`;

  useEffect(() => {
    if (!enabled) return;

    const channel: RealtimeChannel = supabase.channel(topic);

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

    channel.subscribe((status, err) => {
      // Differentiate real failures from transient connection blips.
      // CHANNEL_ERROR with no `err` arg fires from RealtimeClient._onConnClose
      // for every channel whenever the websocket closes (idle tab, network
      // blip, supabase server graceful restart). The client auto-reconnects
      // and channels re-subscribe — pure noise. CHANNEL_ERROR *with* an
      // Error object (binding mismatch, RLS rejection, postgres-changes
      // misconfig) is the real signal worth screaming about.
      if (status === 'CHANNEL_ERROR' && err) {
        console.error(`[realtime] ${channelName} CHANNEL_ERROR`, err);
      } else if (status === 'CHANNEL_ERROR') {
        console.debug(`[realtime] ${channelName} CHANNEL_ERROR (connection close)`);
      } else if (status === 'TIMED_OUT') {
        console.warn(`[realtime] ${channelName} TIMED_OUT`, err ?? '');
      } else if (status === 'CLOSED') {
        console.debug(`[realtime] ${channelName} CLOSED`);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, topic, table, schema, filter, events.join(','), queryClient]); // eslint-disable-line react-hooks/exhaustive-deps
}
