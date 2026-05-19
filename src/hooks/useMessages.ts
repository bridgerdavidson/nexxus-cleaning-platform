'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { useVisibilityRefetch } from './useVisibilityRefetch';
import { MessageWithDetails, MessageAttachment, UserProfile } from '../types';

interface UseMessagesOptions {
  conversationId: string | null;
  userId: string;
  limit?: number;
  onUnreadCountUpdate?: (conversationId: string, newCount: number) => void;
}

async function enrichMessages(
  messagesData: { id: string; sender_id: string; recipient_id: string; [key: string]: unknown }[]
): Promise<MessageWithDetails[]> {
  const senderIds = [...new Set(messagesData.map(m => m.sender_id))];
  const recipientIds = [...new Set(messagesData.map(m => m.recipient_id))];
  const profileIds = [...new Set([...senderIds, ...recipientIds])];

  const { data: profilesData } = await supabase
    .from('user_profiles')
    .select('*')
    .in('id', profileIds);
  const profilesMap = new Map<string, UserProfile>(
    (profilesData ?? []).map(p => [p.id, p as UserProfile])
  );

  const messageIds = messagesData.map(m => m.id);
  const { data: attachmentsData } = await supabase
    .from('message_attachments')
    .select('*')
    .in('message_id', messageIds);
  const attachmentsMap = new Map<string, MessageAttachment[]>();
  attachmentsData?.forEach(att => {
    if (!attachmentsMap.has(att.message_id)) attachmentsMap.set(att.message_id, []);
    attachmentsMap.get(att.message_id)!.push(att);
  });

  return messagesData.map(msg => ({
    ...msg,
    sender: profilesMap.get(msg.sender_id) || null,
    recipient: profilesMap.get(msg.recipient_id) || null,
    attachments: attachmentsMap.get(msg.id) || [],
  })) as MessageWithDetails[];
}

export function useMessages({ conversationId, userId, limit = 50, onUnreadCountUpdate }: UseMessagesOptions) {
  const queryClient = useQueryClient();
  const queryKey = keys.messages.byConversation(conversationId ?? '');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasMarkedAsReadRef = useRef<string | null>(null);

  // hasMore is tracked separately from the cached data because it's a function
  // of the most-recent fetch, not a property of the cache itself.
  const [hasMore, setHasMore] = useState(false);

  const query = useQuery({
    queryKey,
    enabled: !!conversationId && !!userId,
    // Background safety net: realtime is the primary delivery mechanism; this
    // catches the rare silent-drop case where a channel fails to resubscribe
    // after a network blip. Foreground only — no point polling a hidden tab.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data: messagesData, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId as string)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      if (!messagesData || messagesData.length === 0) {
        setHasMore(false);
        return [] as MessageWithDetails[];
      }

      const enriched = await enrichMessages(messagesData);
      const chronological = [...enriched].reverse();
      setHasMore(messagesData.length === limit);
      return chronological;
    },
  });

  // Realtime: append new messages, replace optimistic temp messages, and
  // patch UPDATE events. DB-level filter scopes us to this conversation only.
  useSupabaseRealtimeSync({
    channelName: `messages:conversation:${conversationId ?? ''}`,
    table: 'messages',
    filter: conversationId ? `conversation_id=eq.${conversationId}` : undefined,
    enabled: !!conversationId,
    onEvent: payload => {
      const event = payload.eventType;
      const row = (payload.new ?? payload.old) as { id?: string } | undefined;
      if (!row?.id) return;

      if (event === 'INSERT') {
        const newMsg = payload.new as unknown as MessageWithDetails & {
          id: string;
          sender_id: string;
          recipient_id: string;
        };

        // Patch synchronously using profiles already present in the cache —
        // sender/recipient are stable across a conversation, so prior bubbles
        // carry the same profile rows we need. Saves two round-trips per
        // INSERT and removes a failure point. Attachments arrive on a
        // separate channel; new messages start with `attachments: []` and
        // get patched in by the message_attachments subscription below.
        let didEnrichLocally = true;
        queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev => {
          const list = prev ?? [];
          // Skip if the real ID is already in cache (echo of our own setQueryData).
          if (list.some(m => m.id === newMsg.id)) return list;

          const sender =
            list.find(m => m.sender?.id === newMsg.sender_id)?.sender ??
            list.find(m => m.recipient?.id === newMsg.sender_id)?.recipient ??
            null;
          const recipient =
            list.find(m => m.recipient?.id === newMsg.recipient_id)?.recipient ??
            list.find(m => m.sender?.id === newMsg.recipient_id)?.sender ??
            null;

          if (!sender || !recipient) {
            didEnrichLocally = false;
            // Don't commit a half-enriched bubble; let the async fallback
            // below fetch profiles and patch.
            return list;
          }

          const incoming: MessageWithDetails = {
            ...newMsg,
            sender,
            recipient,
            attachments: [],
          };

          // Replace any matching optimistic temp- message from this sender.
          const tempIdx = list.findIndex(
            m =>
              m.id.startsWith('temp-') &&
              m.sender_id === incoming.sender_id &&
              m.content === incoming.content
          );
          const next = tempIdx >= 0
            ? [...list.slice(0, tempIdx), incoming, ...list.slice(tempIdx + 1)]
            : [...list, incoming];
          return next.sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });

        // Auto-mark-as-read for messages this user receives while viewing the
        // conversation.
        if (newMsg.recipient_id === userId) {
          void supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id);
        }

        // Smooth-scroll to the latest message.
        if (didEnrichLocally) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 50);
        } else {
          // Cold start: cache had no prior messages, so we couldn't reuse a
          // profile. Fall back to one-shot enrichment.
          void (async () => {
            const enriched = await enrichMessages([
              newMsg as unknown as Parameters<typeof enrichMessages>[0][number],
            ]);
            const incoming = enriched[0];
            if (!incoming) return;
            queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev => {
              const list = prev ?? [];
              if (list.some(m => m.id === incoming.id)) return list;
              const tempIdx = list.findIndex(
                m =>
                  m.id.startsWith('temp-') &&
                  m.sender_id === incoming.sender_id &&
                  m.content === incoming.content
              );
              const next = tempIdx >= 0
                ? [...list.slice(0, tempIdx), incoming, ...list.slice(tempIdx + 1)]
                : [...list, incoming];
              return next.sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
            });
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
          })();
        }
        return;
      }

      if (event === 'UPDATE') {
        const updated = payload.new as { id: string; [key: string]: unknown };
        return {
          type: 'patch',
          key: queryKey,
          updater: prev => {
            const list = Array.isArray(prev) ? (prev as MessageWithDetails[]) : [];
            return list.map(m => (m.id === updated.id ? { ...m, ...updated } : m));
          },
        };
      }
    },
  });

  // Attachments are inserted by the sender RIGHT AFTER the parent message
  // row. The `messages` realtime event can fire before those attachment rows
  // are visible, so a bubble can briefly render with empty `attachments`.
  // This sub patches the cache as attachments land so the photos pop in
  // without waiting for a full refetch.
  useSupabaseRealtimeSync({
    channelName: `message_attachments:conversation:${conversationId ?? ''}`,
    table: 'message_attachments',
    enabled: !!conversationId,
    onEvent: payload => {
      if (payload.eventType !== 'INSERT') return;
      const att = payload.new as unknown as MessageAttachment | undefined;
      if (!att?.message_id) return;
      return {
        type: 'patch',
        key: queryKey,
        updater: prev => {
          const list = Array.isArray(prev) ? (prev as MessageWithDetails[]) : [];
          const idx = list.findIndex(m => m.id === att.message_id);
          if (idx === -1) return list; // message not in this conversation's cache
          const existing = list[idx];
          const existingAtts = existing.attachments ?? [];
          // Dedupe by file_url — `useSendMessage` optimistically injects
          // attachments with `pending-` ids, so an id match would miss those
          // and we'd render every photo twice. file_url is stable between
          // optimistic and realtime.
          if (existingAtts.some(a => a.file_url === att.file_url)) {
            // Upgrade the optimistic entry with the real row (so deletes / ids
            // work going forward).
            const next = [...list];
            next[idx] = {
              ...existing,
              attachments: existingAtts.map(a =>
                a.file_url === att.file_url ? att : a,
              ),
            };
            return next;
          }
          const next = [...list];
          next[idx] = { ...existing, attachments: [...existingAtts, att] };
          return next;
        },
      };
    },
  });

  // Recover from missed realtime events on tab focus.
  useVisibilityRefetch({
    keys: [queryKey],
    enabled: !!conversationId && !!userId,
  });

  // Reset the "marked as read" guard whenever conversation changes.
  useEffect(() => {
    if (conversationId) hasMarkedAsReadRef.current = null;
  }, [conversationId]);

  const markMessagesAsRead = useCallback(async () => {
    if (!conversationId || !userId) return;
    if (hasMarkedAsReadRef.current === conversationId) return;

    const list = queryClient.getQueryData<MessageWithDetails[]>(queryKey) ?? [];
    const unreadCount = list.filter(
      m => m.conversation_id === conversationId && m.recipient_id === userId && !m.is_read
    ).length;

    if (unreadCount === 0) {
      hasMarkedAsReadRef.current = conversationId;
      return;
    }

    hasMarkedAsReadRef.current = conversationId;

    queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev =>
      (prev ?? []).map(m =>
        m.conversation_id === conversationId && m.recipient_id === userId && !m.is_read
          ? { ...m, is_read: true }
          : m
      )
    );
    onUnreadCountUpdate?.(conversationId, 0);

    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (error) {
      // Revert on error
      queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev =>
        (prev ?? []).map(m =>
          m.conversation_id === conversationId && m.recipient_id === userId && m.is_read
            ? { ...m, is_read: false }
            : m
        )
      );
      onUnreadCountUpdate?.(conversationId, unreadCount);
      hasMarkedAsReadRef.current = null;
    }
  }, [conversationId, userId, queryClient, queryKey, onUnreadCountUpdate]);

  // Auto-mark-as-read when messages load for the active conversation.
  useEffect(() => {
    if (!conversationId || !userId) return;
    const messages = query.data ?? [];
    if (messages.length === 0) return;
    if (hasMarkedAsReadRef.current === conversationId) return;

    const hasUnread = messages.some(
      m => m.conversation_id === conversationId && m.recipient_id === userId && !m.is_read
    );

    if (hasUnread) {
      void markMessagesAsRead();
    } else {
      hasMarkedAsReadRef.current = conversationId;
      onUnreadCountUpdate?.(conversationId, 0);
    }
  }, [conversationId, userId, query.data, markMessagesAsRead, onUnreadCountUpdate]);

  // Optimistic append (used by MessageThread when sending a message).
  const addMessage = useCallback(
    (message: MessageWithDetails) => {
      queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev => {
        const list = prev ?? [];
        if (list.some(m => m.id === message.id)) return list;
        return [...list, message].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    },
    [queryClient, queryKey]
  );

  // Cursor-based load-more: fetch older messages and prepend to the cache.
  const loadMoreMessages = useCallback(async () => {
    if (!conversationId) return;
    const list = queryClient.getQueryData<MessageWithDetails[]>(queryKey) ?? [];
    if (list.length === 0) return;
    const cursor = list[0].created_at;

    const { data: olderData, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .lt('created_at', cursor)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !olderData || olderData.length === 0) {
      setHasMore(false);
      return;
    }

    const enriched = await enrichMessages(olderData);
    const olderChronological = [...enriched].reverse();
    queryClient.setQueryData<MessageWithDetails[]>(queryKey, prev => [
      ...olderChronological,
      ...(prev ?? []),
    ]);
    setHasMore(olderData.length === limit);
  }, [conversationId, queryClient, queryKey, limit]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    hasMore,
    messagesEndRef,
    loadMoreMessages,
    markMessagesAsRead,
    addMessage,
    refetch,
    subscriptionStatus: 'connected' as const,
  };
}
