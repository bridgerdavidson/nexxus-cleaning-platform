'use client';

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useToast } from '../contexts/ToastContext';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { describeNotification, toastVariantForTone } from '../lib/notifications/labels';

export interface NotificationItem {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  appointment_id: string | null;
  organization_id: string;
  created_at: string;
  in_app_dispatched_at: string | null;
}

const PAGE_SIZE = 30;

// Stable empty reference so unreadCount's useMemo doesn't recompute every render
// while the query is still loading (query.data is undefined).
const EMPTY_ITEMS: NotificationItem[] = [];

// Module-scoped (shared across every useNotifications instance) so a given notification row fires
// exactly ONE toast. The bell mounts more than once per page (desktop TopBar + MobileTopBar), and
// React StrictMode / realtime redelivery can deliver the same INSERT multiple times — without this,
// a single failure showed up as a stack of identical toasts. Bounded so it can't grow unbounded.
const toastedNotificationIds = new Set<string>();
function markToastedOnce(id: string): boolean {
  if (toastedNotificationIds.has(id)) return false;
  if (toastedNotificationIds.size > 500) toastedNotificationIds.clear();
  toastedNotificationIds.add(id);
  return true;
}

/**
 * The user's in-app notification feed, backed by the notification_events outbox.
 *
 * RLS scopes rows to recipient_user_id = auth.uid(), so the query is per-user
 * (not org-scoped). Realtime keeps it live: an INSERT also fires a toast, and
 * both INSERT and UPDATE invalidate the (newest-first) list so it re-sorts
 * correctly rather than appending to the end. Read state is the
 * in_app_dispatched_at timestamp, flipped via the service-role mark-read route
 * (the table has no client UPDATE policy).
 */
export function useNotifications() {
  const { user, accessToken } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const queryKey = keys.notifications.byUser(userId);

  const query = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_events')
        .select(
          'id, event_type, payload, appointment_id, organization_id, created_at, in_app_dispatched_at',
        )
        .eq('recipient_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as NotificationItem[];
    },
  });

  useSupabaseRealtimeSync({
    channelName: `notifications:${userId}`,
    table: 'notification_events',
    filter: userId ? `recipient_user_id=eq.${userId}` : undefined,
    events: ['INSERT', 'UPDATE'],
    enabled: !!userId,
    onEvent: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      if (payload.eventType === 'INSERT') {
        const row = payload.new as Partial<NotificationItem> | undefined;
        // Toast once per row id, across all bell instances / redeliveries.
        if (row?.id && row.event_type && markToastedOnce(row.id)) {
          const d = describeNotification(row.event_type, row.payload);
          showToast(d.title, {
            variant: toastVariantForTone(d.tone),
            description: d.detail,
          });
        }
      }
      return { type: 'invalidate', keys: [queryKey] };
    },
  });

  const items = query.data ?? EMPTY_ITEMS;
  const unreadCount = useMemo(
    () => items.filter((n) => !n.in_app_dispatched_at).length,
    [items],
  );

  // Mark read via the service-role route. Optimistically flip in_app_dispatched_at
  // so the badge/highlight clears instantly; roll back on error; reconcile on settle.
  const markReadMutation = useMutation<{ updated: number }, Error, string[] | undefined, { prev?: NotificationItem[] }>({
    mutationFn: async (ids) => {
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!res.ok) throw new Error('Failed to mark notifications read');
      return res.json();
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<NotificationItem[]>(queryKey);
      const stamp = new Date().toISOString();
      queryClient.setQueryData<NotificationItem[]>(queryKey, (old) =>
        (old ?? []).map((n) =>
          (!ids || ids.includes(n.id)) && !n.in_app_dispatched_at
            ? { ...n, in_app_dispatched_at: stamp }
            : n,
        ),
      );
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const markAllRead = useCallback(() => {
    if (unreadCount === 0) return;
    markReadMutation.mutate(undefined);
  }, [markReadMutation, unreadCount]);

  const markOneRead = useCallback(
    (id: string) => {
      markReadMutation.mutate([id]);
    },
    [markReadMutation],
  );

  const markManyRead = useCallback(
    (ids: string[]) => {
      if (ids.length > 0) markReadMutation.mutate(ids);
    },
    [markReadMutation],
  );

  // One-click accept of a cleaner's counter-proposed time, straight from the bell.
  // The notification row carries the organization_id and (in its payload) the
  // suggested_time_id, so no extra lookup is needed.
  const acceptCounterMutation = useMutation<
    unknown,
    Error,
    { appointmentId: string; organizationId: string; suggestedTimeId: string }
  >({
    mutationFn: async ({ appointmentId, organizationId, suggestedTimeId }) => {
      const res = await fetch('/api/appointments/accept-counter-proposal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ appointmentId, organizationId, suggestedTimeId }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || 'Failed to accept the proposed time');
      }
      return res.json();
    },
    onSuccess: () => {
      showToast('Time confirmed', { variant: 'success' });
      queryClient.invalidateQueries({ queryKey: keys.appointments.all });
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      showToast(err.message, { variant: 'error' });
    },
  });

  const acceptCounterProposal = useCallback(
    (args: { appointmentId: string; organizationId: string; suggestedTimeId: string }) =>
      acceptCounterMutation.mutateAsync(args).catch(() => undefined),
    [acceptCounterMutation],
  );

  return {
    notifications: items,
    unreadCount,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    markAllRead,
    markOneRead,
    markManyRead,
    acceptCounterProposal,
    acceptCounterPending: acceptCounterMutation.isPending,
  };
}
