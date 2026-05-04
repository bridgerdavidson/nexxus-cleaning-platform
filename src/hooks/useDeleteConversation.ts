'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';

export function useDeleteConversation() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (conversationId: string) => {
      const { data: messages } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId);

      if (messages && messages.length > 0) {
        const messageIds = messages.map(m => m.id);
        await supabase.from('message_attachments').delete().in('message_id', messageIds);
      }

      const { error: messagesError } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId);
      if (messagesError) throw messagesError;

      const { error: conversationError } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);
      if (conversationError) throw conversationError;

      return conversationId;
    },
    onSuccess: conversationId => {
      queryClient.invalidateQueries({ queryKey: keys.messages.byConversation(conversationId) });
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: keys.conversations.byUser(user.id) });
      }
    },
  });

  const deleteConversation = async (conversationId: string) => {
    try {
      await mutation.mutateAsync(conversationId);
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete conversation';
      return { success: false, error: errorMessage };
    }
  };

  return {
    deleteConversation,
    deleting: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}
