import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ConversationWithDetails, UserRole } from '../types';

interface UseConversationsOptions {
  userId: string;
  searchQuery?: string;
  roleFilter?: UserRole | 'all';
}

export function useConversations({ userId, searchQuery = '', roleFilter = 'all' }: UseConversationsOptions) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    fetchConversations();

    // Set up real-time subscription
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          // Only refresh if the conversation involves this user
          const conv = payload.new as any;
          if (conv.participant_1_id === userId || conv.participant_2_id === userId) {
            fetchConversations();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          // Refresh if message involves this user
          if (payload.new.sender_id === userId || payload.new.recipient_id === userId) {
            fetchConversations();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          // Refresh when messages are marked as read (updates unread count)
          // This is a backup - optimistic updates handle instant UI feedback
          const updatedMessage = payload.new as { recipient_id: string; is_read: boolean; conversation_id: string | null };
          if (updatedMessage.recipient_id === userId && updatedMessage.is_read === true && updatedMessage.conversation_id) {
            // Reduced delay since optimistic updates handle instant feedback
            setTimeout(() => {
              fetchConversations();
            }, 100);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch conversations where user is a participant
      const { data: conversationsData, error: conversationsError } = await supabase
        .from('conversations')
        .select('*')
        .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
        .order('last_message_at', { ascending: false });

      if (conversationsError) {
        console.error('Error fetching conversations:', conversationsError);
        throw conversationsError;
      }

      if (!conversationsData || conversationsData.length === 0) {
        console.log('No conversations found');
        setConversations([]);
        setLoading(false);
        return;
      }

      // Get all participant IDs (excluding current user)
      const participantIds = conversationsData.map(conv => 
        conv.participant_1_id === userId ? conv.participant_2_id : conv.participant_1_id
      );

      // Fetch all participant profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from('user_profiles')
        .select('*')
        .in('id', participantIds);

      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
        throw profilesError;
      }

      // Fetch last message for each conversation
      const conversationIds = conversationsData.map(conv => conv.id);
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false });

      if (messagesError) throw messagesError;

      // Fetch unread counts - count unread messages where current user is recipient
      const { data: unreadData, error: unreadError } = await supabase
        .from('messages')
        .select('conversation_id, id')
        .in('conversation_id', conversationIds)
        .eq('recipient_id', userId)
        .eq('is_read', false);

      if (unreadError) {
        console.error('Error fetching unread counts:', unreadError);
        // Continue without unread counts rather than failing
      }

      // Map profiles by ID
      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

      // Map last message by conversation_id
      const lastMessageMap = new Map();
      messagesData?.forEach(msg => {
        if (!lastMessageMap.has(msg.conversation_id)) {
          lastMessageMap.set(msg.conversation_id, msg);
        }
      });

      // Map unread counts by conversation_id
      const unreadCountMap = new Map();
      unreadData?.forEach(msg => {
        const count = unreadCountMap.get(msg.conversation_id) || 0;
        unreadCountMap.set(msg.conversation_id, count + 1);
      });

      // Combine data - filter out conversations where participant profile is missing
      const enrichedConversations: ConversationWithDetails[] = conversationsData
        .map(conv => {
          const otherParticipantId = conv.participant_1_id === userId ? conv.participant_2_id : conv.participant_1_id;
          const otherParticipant = profilesMap.get(otherParticipantId);
          const lastMessage = lastMessageMap.get(conv.id) || null;
          const unreadCount = unreadCountMap.get(conv.id) || 0;

          // Skip if participant profile not found
          if (!otherParticipant) {
            return null;
          }

          return {
            ...conv,
            other_participant: otherParticipant,
            last_message: lastMessage,
            unread_count: unreadCount
          };
        })
        .filter((conv): conv is ConversationWithDetails => conv !== null);

      setConversations(enrichedConversations);
    } catch (err) {
      console.error('Error fetching conversations:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch conversations');
    } finally {
      setLoading(false);
    }
  };

  // Optimistically update unread count for a conversation
  const updateUnreadCount = (conversationId: string, newCount: number) => {
    setConversations(prev => 
      prev.map(conv => 
        conv.id === conversationId
          ? { ...conv, unread_count: newCount }
          : conv
      )
    );
  };

  // Apply filters
  const filteredConversations = conversations.filter(conv => {
    // Skip if participant is missing
    if (!conv.other_participant) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      const name = `${conv.other_participant.first_name || ''} ${conv.other_participant.last_name || ''}`.toLowerCase();
      const email = conv.other_participant.email?.toLowerCase() || '';
      
      if (!name.includes(searchLower) && !email.includes(searchLower)) {
        return false;
      }
    }

    // Role filter
    if (roleFilter && roleFilter !== 'all') {
      if (conv.other_participant.role !== roleFilter) {
        return false;
      }
    }

    return true;
  });

  return {
    conversations: filteredConversations,
    loading,
    error,
    refetch: fetchConversations,
    updateUnreadCount
  };
}

