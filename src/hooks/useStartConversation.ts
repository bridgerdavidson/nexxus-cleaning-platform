import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { ConversationWithDetails, UserProfile } from '../types';

interface StartConversationResult {
  success: boolean;
  conversationId?: string;
  conversation?: ConversationWithDetails;
  error?: string;
}

export function useStartConversation() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const startConversation = async (recipientId: string): Promise<StartConversationResult> => {
    if (!user?.id) {
      return { success: false, error: 'Not authenticated' };
    }

    if (recipientId === user.id) {
      return { success: false, error: 'Cannot start conversation with yourself' };
    }

    try {
      setStarting(true);
      setError(null);

      // Get or create conversation using the RPC function
      const { data: conversationId, error: convError } = await supabase
        .rpc('get_or_create_conversation', {
          user1_id: user.id,
          user2_id: recipientId
        });

      if (convError) {
        console.error('Error creating conversation:', convError);
        throw convError;
      }

      if (!conversationId) {
        throw new Error('Failed to create conversation');
      }

      // Fetch the conversation details
      const { data: convData, error: fetchError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (fetchError) {
        console.error('Error fetching conversation:', fetchError);
        // Even if fetch fails, we have the conversation ID
        return { success: true, conversationId };
      }

      // Fetch the other participant's profile
      const otherParticipantId = convData.participant_1_id === user.id 
        ? convData.participant_2_id 
        : convData.participant_1_id;

      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', otherParticipantId)
        .single();

      if (profileError) {
        console.error('Error fetching participant profile:', profileError);
        return { success: true, conversationId };
      }

      // Build full conversation object
      const conversation: ConversationWithDetails = {
        id: convData.id,
        participant_1_id: convData.participant_1_id,
        participant_2_id: convData.participant_2_id,
        last_message_at: convData.last_message_at,
        created_at: convData.created_at,
        other_participant: profileData as UserProfile,
        last_message: null,
        unread_count: 0
      };

      return { 
        success: true, 
        conversationId, 
        conversation 
      };
    } catch (err) {
      console.error('Error starting conversation:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to start conversation';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setStarting(false);
    }
  };

  return {
    startConversation,
    starting,
    error
  };
}

