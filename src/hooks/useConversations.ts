'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { useVisibilityRefetch } from './useVisibilityRefetch';
import { ConversationWithDetails, UserRole, UserProfile, Message } from '../types';

interface UseConversationsOptions {
  userId: string;
  scope?: 'office' | 'job' | 'org-office';
  orgId?: string; // required when scope === 'org-office'
  searchQuery?: string;
  roleFilter?: UserRole | 'all';
}

/**
 * Pick the participant to DISPLAY for a conversation in org-office (shared
 * inbox) mode. The logged-in operator is usually NOT a participant of a
 * customer's office thread, so "the participant that isn't me" is wrong here.
 * Show the CUSTOMER (homeowner/cleaner) participant; for a staff<->staff thread
 * (no customer) fall back to the other party (or participant_1).
 */
function pickDisplayParticipant(
  conv: { participant_1_id: string; participant_2_id: string },
  profiles: Map<string, UserProfile>,
  selfId: string,
): UserProfile | undefined {
  const p1 = profiles.get(conv.participant_1_id);
  const p2 = profiles.get(conv.participant_2_id);
  const isCustomer = (p?: UserProfile) => p?.role === 'homeowner' || p?.role === 'cleaner';
  if (isCustomer(p1)) return p1;
  if (isCustomer(p2)) return p2;
  // staff<->staff: show the other party.
  return conv.participant_1_id === selfId ? p2 : p1;
}

export function useConversations({ userId, scope = 'office', orgId, searchQuery = '', roleFilter = 'all' }: UseConversationsOptions) {
  const queryClient = useQueryClient();
  const isOrgOffice = scope === 'org-office';
  const queryKey = keys.conversations.byUser(userId, scope);

  const query = useQuery({
    queryKey,
    // org-office is org-scoped, so it additionally needs an orgId before it can run.
    enabled: !!userId && (!isOrgOffice || !!orgId),
    // Background safety net for missed realtime events. Foreground only.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      let conversationsData;
      let conversationsError;
      if (isOrgOffice) {
        // Shared OFFICE inbox: every office thread (appointment_id IS NULL) of
        // the org, not just the logged-in operator's own. Authorized by the 099
        // conversations_select_org_office RLS (admin/manager of the org).
        const res = await supabase
          .from('conversations')
          .select('*')
          .eq('organization_id', orgId as string)
          .is('appointment_id', null)
          .order('last_message_at', { ascending: false });
        conversationsData = res.data;
        conversationsError = res.error;
      } else {
        let convQuery = supabase
          .from('conversations')
          .select('*')
          .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`);
        convQuery = scope === 'job'
          ? convQuery.not('appointment_id', 'is', null)
          : convQuery.is('appointment_id', null);
        const res = await convQuery.order('last_message_at', { ascending: false });
        conversationsData = res.data;
        conversationsError = res.error;
      }

      if (conversationsError) throw conversationsError;
      if (!conversationsData || conversationsData.length === 0) return [];

      // org-office: the operator is usually not a participant, so fetch BOTH
      // participants' profiles per thread and derive the customer for display.
      // Participant modes: just the non-self participant, as before.
      const participantIds = isOrgOffice
        ? Array.from(
            new Set(conversationsData.flatMap(conv => [conv.participant_1_id, conv.participant_2_id])),
          )
        : conversationsData.map(conv =>
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
        // Unread is counted as messages addressed to ME and still unread. In
        // org-office mode this is the operator's own unread for the thread (a
        // true team-wide shared-inbox unread model is out of scope); threads
        // they were never addressed in simply show 0, which is acceptable.
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
          const otherParticipant = isOrgOffice
            ? pickDisplayParticipant(conv, profilesMap, userId)
            : profilesMap.get(
                conv.participant_1_id === userId ? conv.participant_2_id : conv.participant_1_id,
              );
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

  // Realtime keys. In org-office mode subscriptions are scoped to the ORG, not
  // the operator (any admin/manager seeing the same org shares one logical
  // stream), and use DB-level organization_id filters. The channel NAMES for
  // the participant scopes are kept byte-identical so office/job callers are
  // unaffected (channel dedup hinges on the exact name).
  const rtEnabled = isOrgOffice ? !!orgId : !!userId;

  // Conversations realtime. Participant mode: invalidate on changes involving
  // this user. Org-office: invalidate on any office-thread change in the org
  // (the org filter + the 099 trigger's UPDATE that stamps organization_id).
  useSupabaseRealtimeSync({
    channelName: isOrgOffice ? `conversations:org:${orgId}:org-office` : `conversations:${userId}:${scope}`,
    table: 'conversations',
    filter: isOrgOffice && orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: rtEnabled,
    onEvent: payload => {
      if (isOrgOffice) return { type: 'invalidate', keys: [queryKey] };
      const conv = (payload.new ?? payload.old) as { participant_1_id?: string; participant_2_id?: string } | undefined;
      if (!conv) return;
      if (conv.participant_1_id !== userId && conv.participant_2_id !== userId) return;
      return { type: 'invalidate', keys: [queryKey] };
    },
  });

  // Messages realtime: any message INSERT/UPDATE that affects a listed thread
  // changes either the last_message preview or the unread count, so we
  // invalidate the conversation list. Participant mode splits into two channels
  // because Supabase realtime filters don't support OR — one matches messages
  // this user sent, the other matches messages addressed to them. Org-office
  // mode uses ONE org-filtered channel instead, so the second (recipient) slot
  // is left idle (the org channel already covers every org message).
  useSupabaseRealtimeSync({
    channelName: isOrgOffice ? `messages:org:${orgId}:org-office` : `messages:sender:${userId}:${scope}`,
    table: 'messages',
    filter: isOrgOffice
      ? (orgId ? `organization_id=eq.${orgId}` : undefined)
      : (userId ? `sender_id=eq.${userId}` : undefined),
    enabled: rtEnabled,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });
  useSupabaseRealtimeSync({
    channelName: `messages:recipient:${userId}:${scope}`,
    table: 'messages',
    filter: userId ? `recipient_id=eq.${userId}` : undefined,
    enabled: !isOrgOffice && !!userId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  // Attachments arrive AFTER the parent message row (sender uploads them
  // sequentially after the INSERT). Subscribe so the conversation list refetches
  // the attachment count once the photos land. message_attachments has no
  // organization_id column, so org-office can't DB-filter it; it just keys the
  // channel by org and invalidates on any attachment event.
  useSupabaseRealtimeSync({
    channelName: isOrgOffice ? `message_attachments:org:${orgId}:org-office` : `message_attachments:user:${userId}:${scope}`,
    table: 'message_attachments',
    enabled: rtEnabled,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  // Recover from missed realtime events on tab focus.
  useVisibilityRefetch({
    keys: [queryKey],
    enabled: !!userId,
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
