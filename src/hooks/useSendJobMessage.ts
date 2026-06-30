'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { uuidv4 } from '@/lib/uuid';
import { keys } from '@/lib/queryKeys';
import { useAuth } from './useAuth';
import type { MessageWithDetails, UserProfile } from '@/types';

export interface SentJobMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  appointment_id: string;
  organization_id: string;
  content: string;
  is_read: boolean;
}

interface SendJobMessageOptions {
  appointmentId: string;
  content: string;
}

/**
 * Send a homeowner<->cleaner job message through the guarded PR1 route. The
 * client cannot INSERT into `messages` for this pair (RLS `can_message_user`
 * forbids homeowner<->cleaner), so the route (service-role) is the only path.
 * Idempotent via a client-generated `clientMessageId`. On success we patch the
 * sender's message cache so the bubble appears immediately (the realtime echo
 * then dedupes by id), and invalidate the job-conversation list.
 */
export function useSendJobMessage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ appointmentId, content }: SendJobMessageOptions): Promise<SentJobMessage> => {
      const token = await getAccessToken();
      if (!token) throw new Error('You are signed out. Please sign in again.');
      const res = await fetch(`/api/appointments/${appointmentId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content, clientMessageId: uuidv4() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || 'Could not send the message.');
      }
      return (json as { message: SentJobMessage }).message;
    },
    onSuccess: (message) => {
      // Patch the sender's thread cache so the bubble shows without waiting for
      // realtime. The realtime INSERT echo dedupes by id (useMessages checks it).
      const cacheKey = keys.messages.byConversation(message.conversation_id);
      const nowIso = new Date().toISOString();
      const full: MessageWithDetails = {
        id: message.id,
        organization_id: message.organization_id,
        conversation_id: message.conversation_id,
        sender_id: message.sender_id,
        recipient_id: message.recipient_id,
        appointment_id: message.appointment_id,
        subject: null,
        content: message.content,
        is_read: false,
        created_at: nowIso,
        sender: null as unknown as UserProfile,
        recipient: null as unknown as UserProfile,
        attachments: [],
      };
      queryClient.setQueryData<MessageWithDetails[]>(cacheKey, (prev) => {
        const list = prev ?? [];
        if (list.some((m) => m.id === full.id)) return list;
        return [...list, full].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: keys.conversations.byUser(user.id, 'job') });
      }
    },
  });

  const sendJobMessage = async (opts: SendJobMessageOptions) => {
    try {
      const message = await mutation.mutateAsync(opts);
      return { success: true as const, message, conversationId: message.conversation_id };
    } catch (err) {
      return { success: false as const, error: err instanceof Error ? err.message : 'Could not send the message.' };
    }
  };

  return { sendJobMessage, sending: mutation.isPending };
}
