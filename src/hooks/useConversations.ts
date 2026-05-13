'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { ConversationWithDetails, UserRole, UserProfile, Message } from '../types';

interface UseConversationsOptions {
  userId: string;
  searchQuery?: string;
  roleFilter?: UserRole | 'all';
}

export function useConversations({ userId, searchQuery = '', roleFilter = 'all' }: UseConversationsOptions) {
  const queryClient = useQueryClient();
  const queryKey = keys.conversations.byUser(userId);

  const query = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async () => {
      const { data: conversationsData, error: conversationsError } = await supabase
        .from('conversations')
        .select('*')
        .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
        .order('last_message_at', { ascending: false });

      if (conversationsError) throw conversationsError;
      if (!conversationsData || conversationsData.length === 0) return [];

      const participantIds = conversationsData.map(conv =>
        conv.participant_1_id === userId ? conv.participant_2_id : conv.participant_1_id
      );

      const conversationIds = conversationsData.map(c => c.id);

      const [profilesRes, messagesRes, unreadRes] = await Promise.all([
        supabase
          .from('user_profiles')
          .select('*')
          .in('id', participantIds),
        supabase
          .from('messages')
          .select('*')
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('messages')
          .select('conversation_id, id')
          .in('conversation_id', conversationIds)
          .eq('recipient_id', userId)
          .eq('is_read', false),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (messagesRes.error) throw messagesRes.error;

      const profilesMap = new Map<string, UserProfile>(
        (profilesRes.data ?? []).map(p => [p.id, p as UserProfile])
      );

      const lastMessageMap = new Map<string, Message>();
      messagesRes.data?.forEach(msg => {
        if (msg.conversation_id && !lastMessageMap.has(msg.conversation_id)) {
          lastMessageMap.set(msg.conversation_id, msg as Message);
        }
      });

      const unreadCountMap = new Map<string, number>();
      unreadRes.data?.forEach(msg => {
        const count = unreadCountMap.get(msg.conversation_id) ?? 0;
        unreadCountMap.set(msg.conversation_id, count + 1);
      });

      // Fetch attachment counts for just the "last message" of each
      // conversation so we can render a "Photo" preview when the message has
      // no text content. Bounded by the conversation count, not total
      // messages, so the cost is tiny.
      const lastMessageIds = Array.from(lastMessageMap.values()).map(m => m.id);
      const attachmentCountMap = new Map<string, number>();
      if (lastMessageIds.length > 0) {
        const { data: attachments, error: attachmentsError } = await supabase
          .from('message_attachments')
          .select('message_id')
          .in('message_id', lastMessageIds);
        if (attachmentsError) throw attachmentsError;
        attachments?.forEach(a => {
          const mid = a.message_id as string;
          attachmentCountMap.set(mid, (attachmentCountMap.get(mid) ?? 0) + 1);
        });
      }

      return conversationsData
        .map(conv => {
          const otherId = conv.participant_1_id === userId ? conv.participant_2_id : conv.participant_1_id;
          const otherParticipant = profilesMap.get(otherId);
          if (!otherParticipant) return null;
          const lastMsg = lastMessageMap.get(conv.id) ?? null;
          return {
            ...conv,
            other_participant: otherParticipant,
            last_message: lastMsg,
            last_message_attachment_count: lastMsg ? (attachmentCountMap.get(lastMsg.id) ?? 0) : 0,
            unread_count: unreadCountMap.get(conv.id) ?? 0,
          } as ConversationWithDetails;
        })
        .filter((c): c is ConversationWithDetails => c !== null);
    },
  });

  // Conversations realtime: invalidate on INSERT/DELETE that involve this user.
  useSupabaseRealtimeSync({
    channelName: `conversations:${userId}`,
    table: 'conversations',
    enabled: !!userId,
    onEvent: payload => {
      const conv = (payload.new ?? payload.old) as { participant_1_id?: string; participant_2_id?: string } | undefined;
      if (!conv) return;
      if (conv.participant_1_id !== userId && conv.participant_2_id !== userId) return;
      return { type: 'invalidate', keys: [queryKey] };
    },
  });

  // Messages realtime: any message INSERT/UPDATE that involves this user
  // changes either the last_message preview or the unread count, so we
  // invalidate the conversation list. The bespoke optimistic patches that
  // existed before are gone — refetch is simpler and the cost is negligible
  // for the typical conversation count per user.
  useSupabaseRealtimeSync({
    channelName: `messages:user:${userId}`,
    table: 'messages',
    enabled: !!userId,
    onEvent: payload => {
      const msg = (payload.new ?? payload.old) as { sender_id?: string; recipient_id?: string } | undefined;
      if (!msg) return;
      if (msg.sender_id !== userId && msg.recipient_id !== userId) return;
      return { type: 'invalidate', keys: [queryKey] };
    },
  });

  // Attachments arrive AFTER the parent message row (sender uploads them
  // sequentially after the INSERT). Subscribe so the recipient's conversation
  // list refetches the attachment count once the photos land.
  useSupabaseRealtimeSync({
    channelName: `message_attachments:user:${userId}`,
    table: 'message_attachments',
    enabled: !!userId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  // Optimistic unread-count update (used by useMessages on markAsRead).
  const updateUnreadCount = useCallback(
    (conversationId: string, newCount: number) => {
      queryClient.setQueryData<ConversationWithDetails[]>(queryKey, prev =>
        (prev ?? []).map(conv =>
          conv.id === conversationId ? { ...conv, unread_count: newCount } : conv
        )
      );
    },
    [queryClient, queryKey]
  );

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  // Apply client-side filters
  const filteredConversations = useMemo(() => {
    const conversations = query.data ?? [];
    return conversations.filter(conv => {
      if (!conv.other_participant) return false;
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const name = `${conv.other_participant.first_name || ''} ${conv.other_participant.last_name || ''}`.toLowerCase();
        const email = conv.other_participant.email?.toLowerCase() || '';
        if (!name.includes(searchLower) && !email.includes(searchLower)) return false;
      }
      if (roleFilter && roleFilter !== 'all') {
        if (conv.other_participant.role !== roleFilter) return false;
      }
      return true;
    });
  }, [query.data, searchQuery, roleFilter]);

  return {
    conversations: filteredConversations,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch,
    updateUnreadCount,
    subscriptionStatus: 'connected' as const,
  };
}
