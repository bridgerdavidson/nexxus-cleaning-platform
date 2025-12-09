import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function useDeleteConversation() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteConversation = async (conversationId: string) => {
    try {
      setDeleting(true);
      setError(null);

      // Delete all message attachments first
      const { data: messages } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId);

      if (messages && messages.length > 0) {
        const messageIds = messages.map(m => m.id);
        
        // Delete attachments
        const { error: attachmentError } = await supabase
          .from('message_attachments')
          .delete()
          .in('message_id', messageIds);

        if (attachmentError) {
          console.error('Error deleting attachments:', attachmentError);
        }
      }

      // Delete all messages in the conversation
      const { error: messagesError } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (messagesError) throw messagesError;

      // Delete the conversation
      const { error: conversationError } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);

      if (conversationError) throw conversationError;

      return { success: true };
    } catch (err) {
      console.error('Error deleting conversation:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete conversation';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setDeleting(false);
    }
  };

  return {
    deleteConversation,
    deleting,
    error
  };
}

