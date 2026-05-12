'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';
import {
  MESSAGING_FORBIDDEN_TEXT,
  isMessagingForbiddenError,
} from '../lib/messagingPermissions';
import { ConversationWithDetails, UserProfile } from '../types';

interface StartConversationResult {
  success: boolean;
  conversationId?: string;
  conversation?: ConversationWithDetails;
  error?: string;
}

export function useStartConversation() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (recipientId: string) => {
      if (!user?.id) throw new Error('Not authenticated');
      if (recipientId === user.id) throw new Error('Cannot start conversation with yourself');

      const { data: conversationId, error: convError } = await supabase.rpc(
        'get_or_create_conversation',
        { user1_id: user.id, user2_id: recipientId }
      );
      if (convError) throw convError;
      if (!conversationId) throw new Error('Failed to create conversation');

      const { data: convData, error: fetchError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();
      if (fetchError) {
        return { conversationId: conversationId as string, conversation: undefined };
      }

      const otherParticipantId =
        convData.participant_1_id === user.id ? convData.participant_2_id : convData.participant_1_id;

      const { data: profileData } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', otherParticipantId)
        .single();

      const conversation: ConversationWithDetails | undefined = profileData
        ? {
            id: convData.id,
            participant_1_id: convData.participant_1_id,
            participant_2_id: convData.participant_2_id,
            last_message_at: convData.last_message_at,
            created_at: convData.created_at,
            other_participant: profileData as UserProfile,
            last_message: null,
            unread_count: 0,
          }
        : undefined;

      return { conversationId: conversationId as string, conversation };
    },
    onSuccess: () => {
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: keys.conversations.byUser(user.id) });
      }
    },
  });

  const startConversation = async (recipientId: string): Promise<StartConversationResult> => {
    try {
      const result = await mutation.mutateAsync(recipientId);
      return {
        success: true,
        conversationId: result.conversationId,
        conversation: result.conversation,
      };
    } catch (err) {
      if (isMessagingForbiddenError(err)) {
        return { success: false, error: MESSAGING_FORBIDDEN_TEXT };
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to start conversation';
      return { success: false, error: errorMessage };
    }
  };

  return {
    startConversation,
    starting: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}
