import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { ConversationWithDetails, UserRole, Message } from '../types';

interface UseConversationsOptions {
  userId: string;
  searchQuery?: string;
  roleFilter?: UserRole | 'all';
}

export function useConversations({ userId, searchQuery = '', roleFilter = 'all' }: UseConversationsOptions) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cache profiles to avoid refetching when updating conversations
  const profilesCacheRef = useRef<Map<string, any>>(new Map());

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
        async (payload) => {
          // Optimistically update if message involves this user
          const newMessage = payload.new as { 
            id: string; 
            conversation_id: string | null; 
            sender_id: string; 
            recipient_id: string; 
            content: string; 
            created_at: string;
            is_read: boolean;
          };
          
          if (newMessage.sender_id === userId || newMessage.recipient_id === userId) {
            await optimisticallyUpdateConversationWithMessage(newMessage);
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
          // Optimistically update unread count when messages are marked as read
          const updatedMessage = payload.new as { 
            recipient_id: string; 
            is_read: boolean; 
            conversation_id: string | null;
          };
          
          if (updatedMessage.recipient_id === userId && 
              updatedMessage.is_read === true && 
              updatedMessage.conversation_id) {
            // Optimistically decrement unread count
            optimisticallyUpdateUnreadCount(updatedMessage.conversation_id, -1);
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

      // Map profiles by ID and cache them
      const profilesMap = new Map(profilesData?.map(p => {
        profilesCacheRef.current.set(p.id, p);
        return [p.id, p];
      }) || []);

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

  // Optimistically update unread count by delta (increment/decrement)
  const optimisticallyUpdateUnreadCount = (conversationId: string, delta: number) => {
    setConversations(prev => 
      prev.map(conv => 
        conv.id === conversationId
          ? { ...conv, unread_count: Math.max(0, conv.unread_count + delta) }
          : conv
      )
    );
  };

  // Optimistically update conversation when a new message arrives
  const optimisticallyUpdateConversationWithMessage = async (newMessage: {
    id: string;
    conversation_id: string | null;
    sender_id: string;
    recipient_id: string;
    content: string;
    created_at: string;
    is_read: boolean;
  }) => {
    if (!newMessage.conversation_id) {
      // New conversation - need to fetch it
      fetchConversations();
      return;
    }

    setConversations(prev => {
      // Find the conversation
      const convIndex = prev.findIndex(c => c.id === newMessage.conversation_id);
      
      if (convIndex === -1) {
        // Conversation not in list yet - might be a new conversation
        // Fetch to get the full conversation data
        fetchConversations();
        return prev;
      }

      // Get sender profile from cache or fetch it
      let senderProfile = profilesCacheRef.current.get(newMessage.sender_id);
      
      if (!senderProfile) {
        // Fetch sender profile in background (non-blocking)
        supabase
          .from('user_profiles')
          .select('*')
          .eq('id', newMessage.sender_id)
          .single()
          .then(({ data }) => {
            if (data) {
              profilesCacheRef.current.set(newMessage.sender_id, data);
              // Update conversation again with profile
              setConversations(current => {
                const updated = [...current];
                const idx = updated.findIndex(c => c.id === newMessage.conversation_id);
                if (idx >= 0 && updated[idx].last_message) {
                  updated[idx] = {
                    ...updated[idx],
                    last_message: {
                      ...updated[idx].last_message!,
                      sender: data
                    } as Message
                  };
                }
                return updated;
              });
            }
          });
      }

      // Create message object for last_message
      const messageAsLastMessage: Message = {
        id: newMessage.id,
        organization_id: null,
        conversation_id: newMessage.conversation_id,
        sender_id: newMessage.sender_id,
        recipient_id: newMessage.recipient_id,
        appointment_id: null,
        subject: null,
        content: newMessage.content,
        is_read: newMessage.is_read,
        created_at: newMessage.created_at
      };

      // Update the conversation
      const updated = [...prev];
      const conv = updated[convIndex];
      
      const isRecipient = newMessage.recipient_id === userId;
      const newUnreadCount = isRecipient && !newMessage.is_read
        ? conv.unread_count + 1
        : conv.unread_count;

      updated[convIndex] = {
        ...conv,
        last_message: messageAsLastMessage,
        last_message_at: newMessage.created_at,
        unread_count: newUnreadCount
      };

      // Re-sort by last_message_at (most recent first)
      const sorted = updated.sort((a, b) => {
        const timeA = new Date(a.last_message_at).getTime();
        const timeB = new Date(b.last_message_at).getTime();
        return timeB - timeA;
      });

      return sorted;
    });
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

