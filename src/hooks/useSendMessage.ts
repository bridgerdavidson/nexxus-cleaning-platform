'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { uploadFileToStorage, MESSAGE_ATTACHMENTS_BUCKET } from '../lib/image-upload/uploadOne';
import { uuidv4 } from '../lib/uuid';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';
import type { MessageWithDetails, MessageAttachment, UserProfile } from '../types';
import {
  MESSAGING_FORBIDDEN_TEXT,
  isMessagingForbiddenError,
} from '../lib/messagingPermissions';

interface SendMessageOptions {
  conversationId?: string;
  senderId: string;
  recipientId: string;
  content: string;
  attachments?: File[];
}

export function useSendMessage() {
  const { user, currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      conversationId,
      senderId,
      recipientId,
      content,
      attachments = [],
    }: SendMessageOptions) => {
      if (!currentOrganizationId) {
        throw new Error('No organization selected. Please select an organization to send messages.');
      }

      // Resolve conversation id first — needed for storage paths.
      let finalConversationId = conversationId;
      if (!finalConversationId) {
        const { data: convData, error: convError } = await supabase.rpc('get_or_create_conversation', {
          user1_id: senderId,
          user2_id: recipientId,
        });
        if (convError) throw convError;
        finalConversationId = convData;
      }

      // Pre-generate the message id so we can reference it from the
      // attachments without first inserting the parent row. This lets us
      // upload all photos to storage BEFORE the message row appears, so the
      // recipient (and sender's own view via realtime) never see a blank
      // bubble that pops images in a moment later.
      const messageId = uuidv4();

      const uploaded: Array<{
        url: string;
        path: string;
        fileSize: number;
        fileType: string;
      }> = [];

      try {
        if (attachments.length > 0 && finalConversationId) {
          // Storage uploads in parallel. Each call: HEIC convert → compress →
          // upload to message-attachments bucket. No DB writes yet.
          const results = await Promise.all(
            attachments.map((file) =>
              uploadFileToStorage(file, {
                kind: 'message',
                ctx: {
                  conversationId: finalConversationId!,
                  messageId,
                },
              }),
            ),
          );
          uploaded.push(
            ...results.map((r) => ({
              url: r.url,
              path: r.path,
              fileSize: r.fileSize,
              fileType: r.fileType,
            })),
          );
        }

        // Now insert the message row. Use the pre-generated id.
        const { error: messageError } = await supabase.from('messages').insert({
          id: messageId,
          organization_id: currentOrganizationId,
          conversation_id: finalConversationId,
          sender_id: senderId,
          recipient_id: recipientId,
          content,
          is_read: false,
        });
        if (messageError) throw messageError;

        // Insert attachment rows in one batch (FK requires the message exists).
        if (uploaded.length > 0) {
          const { error: attachmentsError } = await supabase
            .from('message_attachments')
            .insert(
              uploaded.map((u) => ({
                message_id: messageId,
                file_url: u.url,
                file_type: u.fileType,
                file_size: u.fileSize,
              })),
            );
          if (attachmentsError) throw attachmentsError;
        }
      } catch (err) {
        // Best-effort cleanup of orphaned storage objects on failure.
        if (uploaded.length > 0) {
          await supabase.storage
            .from(MESSAGE_ATTACHMENTS_BUCKET)
            .remove(uploaded.map((u) => u.path))
            .catch(() => {});
        }
        throw err;
      }

      return {
        messageId,
        conversationId: finalConversationId as string,
        content,
        senderId,
        recipientId,
        uploaded,
      };
    },
    onSuccess: async result => {
      // Patch the sender's message cache directly so the fully-formed message
      // (with attachments) appears the moment the mutation resolves — bypasses
      // the realtime race where the `messages` INSERT event can arrive before
      // the `message_attachments` rows are visible.
      const cacheKey = keys.messages.byConversation(result.conversationId);
      const senderProfile = queryClient.getQueryData<UserProfile>(['user-profile', result.senderId]);
      const nowIso = new Date().toISOString();

      const attachments: MessageAttachment[] = result.uploaded.map((u, i) => ({
        id: `pending-${result.messageId}-${i}`,
        message_id: result.messageId,
        file_url: u.url,
        file_type: u.fileType,
        file_size: u.fileSize,
        created_at: nowIso,
      }));

      // Re-fetch sender/recipient profile info if we don't already have it cached.
      let senderForBubble = senderProfile;
      if (!senderForBubble && user?.id === result.senderId) {
        // Best-effort: fetch the sender's profile so the bubble renders with
        // the right name/avatar. Skipped if it fails — the realtime echo
        // will reconcile.
        const { data } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', result.senderId)
          .maybeSingle();
        if (data) senderForBubble = data as UserProfile;
      }

      const fullMessage: MessageWithDetails = {
        id: result.messageId,
        organization_id: currentOrganizationId ?? null,
        conversation_id: result.conversationId,
        sender_id: result.senderId,
        recipient_id: result.recipientId,
        appointment_id: null,
        subject: null,
        content: result.content,
        is_read: false,
        created_at: nowIso,
        // sender/recipient are required by the type; cast loosely — the
        // realtime echo will replace this entry with the canonical row.
        sender: (senderForBubble ?? null) as unknown as UserProfile,
        recipient: null as unknown as UserProfile,
        attachments,
      };

      queryClient.setQueryData<MessageWithDetails[]>(cacheKey, prev => {
        const list = prev ?? [];
        if (list.some(m => m.id === fullMessage.id)) return list;
        // Drop any `temp-` placeholder MessageThread may have optimistically
        // added so we don't end up with two bubbles (one empty, one real).
        const cleaned = list.filter(
          m =>
            !(
              m.id.startsWith('temp-') &&
              m.sender_id === fullMessage.sender_id &&
              m.content === fullMessage.content
            ),
        );
        return [...cleaned, fullMessage].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });

      // Conversation list also depends on the new message; let it refetch
      // to pick up last_message + attachment counts canonically.
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: keys.conversations.byUser(user.id) });
      }
    },
  });

  const sendMessage = async (opts: SendMessageOptions) => {
    try {
      const result = await mutation.mutateAsync(opts);
      return { success: true, messageId: result.messageId, conversationId: result.conversationId };
    } catch (err) {
      if (isMessagingForbiddenError(err)) {
        return { success: false, error: MESSAGING_FORBIDDEN_TEXT };
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      return { success: false, error: errorMessage };
    }
  };

  return {
    sendMessage,
    sending: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}
