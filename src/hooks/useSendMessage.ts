'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { uploadImages } from '../lib/upload';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';
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

      let finalConversationId = conversationId;
      if (!finalConversationId) {
        const { data: convData, error: convError } = await supabase.rpc('get_or_create_conversation', {
          user1_id: senderId,
          user2_id: recipientId,
        });
        if (convError) throw convError;
        finalConversationId = convData;
      }

      const { data: messageData, error: messageError } = await supabase
        .from('messages')
        .insert({
          organization_id: currentOrganizationId,
          conversation_id: finalConversationId,
          sender_id: senderId,
          recipient_id: recipientId,
          content,
          is_read: false,
        })
        .select()
        .single();

      if (messageError) throw messageError;

      if (attachments.length > 0) {
        const uploadResults = await uploadImages(attachments);
        const successfulUploads = uploadResults.filter(r => r.success);
        if (successfulUploads.length > 0) {
          const attachmentRecords = successfulUploads.map(result => ({
            message_id: messageData.id,
            file_url: result.url!,
            file_type: attachments[uploadResults.indexOf(result)].type,
            file_size: attachments[uploadResults.indexOf(result)].size,
          }));
          // Don't fail the entire operation if attachment inserts fail.
          await supabase.from('message_attachments').insert(attachmentRecords);
        }
      }

      return { messageId: messageData.id as string, conversationId: finalConversationId as string };
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: keys.messages.byConversation(result.conversationId) });
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
