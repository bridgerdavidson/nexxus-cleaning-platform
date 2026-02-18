import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ConversationWithDetails, UserRole, Message } from '../types';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseConversationsOptions {
  userId: string;
  searchQuery?: string;
  roleFilter?: UserRole | 'all';
}

type SubscriptionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useConversations({ userId, searchQuery = '', roleFilter = 'all' }: UseConversationsOptions) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>('disconnected');
  // Cache profiles to avoid refetching when updating conversations
  const profilesCacheRef = useRef<Map<string, any>>(new Map());
  // Track current channel for cleanup
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Track retry attempts
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  // Store fetch function in ref so it can be called from subscription callbacks
  const fetchConversationsRef = useRef<(() => Promise<void>) | null>(null);
  // Track if retry is in progress to prevent concurrent retries
  const isRetryingRef = useRef(false);
  // Track unread counts to prevent stacking due to async state updates
  const unreadCountByConvRef = useRef<Map<string, number>>(new Map());
  // Refs for subscription callbacks so they always use latest state/updaters (avoid stale closure)
  const optimisticallyUpdateConversationWithMessageRef = useRef<(msg: {
    id: string; conversation_id: string | null; sender_id: string; recipient_id: string;
    content: string; created_at: string; is_read: boolean;
  }) => Promise<void>>(() => Promise.resolve());
  const optimisticallyUpdateUnreadCountRef = useRef<(convId: string, delta: number) => void>(() => {});

  // Subscribe to realtime with retry logic
  const setupSubscription = useCallback(async (currentUserId: string) => {
    // Validate session before subscribing
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn('[useConversations] No valid session, skipping subscription');
      setSubscriptionStatus('disconnected');
      return;
    }

    // Clean up existing channel with proper verification
    if (channelRef.current) {
      const channelToRemove = channelRef.current;
      channelRef.current = null;
      supabase.removeChannel(channelToRemove);
      // Small delay to ensure cleanup completes before creating new channel
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setSubscriptionStatus('connecting');

    // Set up real-time subscription with unique channel name
    const channelName = `conversations-${currentUserId}-${Date.now()}`;
    console.log('[useConversations] Setting up subscription:', channelName);
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          console.log('[useConversations] New conversation INSERT:', payload);
          // Only refresh if the conversation involves this user
          const conv = payload.new as any;
          if (conv.participant_1_id === currentUserId || conv.participant_2_id === currentUserId) {
            // Use ref to call fetchConversations
            if (fetchConversationsRef.current) {
              fetchConversationsRef.current();
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'conversations'
        },
        (payload) => {
          console.log('[useConversations] Conversation DELETE:', payload);
          // Refresh list on delete
          const conv = payload.old as any;
          if (conv.participant_1_id === currentUserId || conv.participant_2_id === currentUserId) {
            if (fetchConversationsRef.current) {
              fetchConversationsRef.current();
            }
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
          console.log('[useConversations] New message INSERT event:', payload.new);
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
          
          // Update for both sender and recipient (use ref so we always run latest updater)
          if (newMessage.sender_id === currentUserId || newMessage.recipient_id === currentUserId) {
            console.log('[useConversations] Message involves current user, updating conversation list');
            await optimisticallyUpdateConversationWithMessageRef.current(newMessage);
          } else {
            console.log('[useConversations] Message does not involve current user, skipping');
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
          console.log('[useConversations] Message UPDATE event:', payload.new);
          // Optimistically update unread count when messages are marked as read
          const updatedMessage = payload.new as { 
            recipient_id: string; 
            is_read: boolean; 
            conversation_id: string | null;
          };
          
          if (updatedMessage.recipient_id === currentUserId && 
              updatedMessage.is_read === true && 
              updatedMessage.conversation_id) {
            // Optimistically decrement unread count (use ref so we always run latest updater)
            optimisticallyUpdateUnreadCountRef.current(updatedMessage.conversation_id, -1);
          }
        }
      )
      .subscribe(async (status, err) => {
        console.log(`[useConversations] Subscription status: ${status}`, err || '');
        
        if (status === 'SUBSCRIBED') {
          setSubscriptionStatus('connected');
          retryCountRef.current = 0; // Reset retry count on success
          isRetryingRef.current = false; // Reset retry flag
          setError(null); // Clear any previous errors
          console.log('[useConversations] Successfully subscribed to conversations and messages');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setSubscriptionStatus('error');
          
          // Safely handle undefined err parameter
          const errorMessage = err?.message || (err && typeof err === 'object' ? JSON.stringify(err) : String(err)) || 'Unknown error';
          const errorDetails = err ? JSON.stringify(err, null, 2) : 'No error details available';
          
          console.error(`[useConversations] Subscription error: ${status}`, {
            status,
            error: errorMessage,
            details: errorDetails,
            channelName,
            userId: currentUserId,
            retryCount: retryCountRef.current
          });
          
          // Don't set error state for transient issues - only log
          // This prevents showing error messages to users for temporary network issues
          
          // Prevent concurrent retry attempts
          if (isRetryingRef.current) {
            console.log('[useConversations] Retry already in progress, skipping');
            return;
          }
          
          // Retry logic with exponential backoff and jitter
          if (retryCountRef.current < maxRetries) {
            isRetryingRef.current = true;
            retryCountRef.current++;
            
            // Exponential backoff with jitter: base delay * 2^attempt + random(0-1000ms)
            const baseDelay = 1000 * Math.pow(2, retryCountRef.current - 1);
            const jitter = Math.random() * 1000;
            const delay = baseDelay + jitter;
            
            console.log(`[useConversations] Retrying subscription (attempt ${retryCountRef.current}/${maxRetries}) in ${Math.round(delay)}ms...`);
            
            setTimeout(async () => {
              // Re-check session before retrying
              const { data: { session: retrySession } } = await supabase.auth.getSession();
              if (!retrySession) {
                console.warn('[useConversations] Session expired during retry, aborting');
                isRetryingRef.current = false;
                setSubscriptionStatus('disconnected');
                return;
              }
              
              isRetryingRef.current = false;
              await setupSubscription(currentUserId);
            }, delay);
          } else {
            isRetryingRef.current = false;
            console.error('[useConversations] Max retries reached. Subscription failed.');
            // Only set error after max retries
            setError(`Unable to establish real-time connection. Messages will still work, but updates may be delayed.`);
          }
        } else if (status === 'CLOSED') {
          setSubscriptionStatus('disconnected');
          isRetryingRef.current = false; // Reset retry flag on close
        }
      });

    channelRef.current = channel;
    return channel;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setSubscriptionStatus('disconnected');
      return;
    }

    // Check if user is authenticated before setting up subscription
    const checkAuthAndSubscribe = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('[useConversations] No session found, skipping subscription');
        setLoading(false);
        return;
      }

      // Fetch conversations first, then set up subscription
      if (fetchConversationsRef.current) {
        await fetchConversationsRef.current();
      }

      // Set up real-time subscription with retry logic
      retryCountRef.current = 0;
      isRetryingRef.current = false;
      setupSubscription(userId);
    };

    checkAuthAndSubscribe();

    return () => {
      // Clean up channel on unmount or userId change
      if (channelRef.current) {
        console.log('[useConversations] Cleaning up subscription');
        const channelToRemove = channelRef.current;
        channelRef.current = null;
        supabase.removeChannel(channelToRemove);
        // Small delay to ensure cleanup completes
        setTimeout(() => {
          setSubscriptionStatus('disconnected');
        }, 100);
      } else {
        setSubscriptionStatus('disconnected');
      }
      // Reset retry state on cleanup
      isRetryingRef.current = false;
      retryCountRef.current = 0;
    };
  }, [userId, setupSubscription]);

  const fetchConversations = useCallback(async () => {
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

          // Seed the unread count ref
          unreadCountByConvRef.current.set(conv.id, unreadCount);

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
  }, [userId]);

  // Store fetch function in ref
  useEffect(() => {
    fetchConversationsRef.current = fetchConversations;
  }, [fetchConversations]);

  // Optimistically update unread count for a conversation
  const updateUnreadCount = (conversationId: string, newCount: number) => {
    // Update ref synchronously to prevent stacking
    unreadCountByConvRef.current.set(conversationId, newCount);
    
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
    // Update ref synchronously to prevent stacking
    const currentCount = unreadCountByConvRef.current.get(conversationId) ?? 0;
    const newCount = Math.max(0, currentCount + delta);
    unreadCountByConvRef.current.set(conversationId, newCount);
    
    setConversations(prev => 
      prev.map(conv => 
        conv.id === conversationId
          ? { ...conv, unread_count: newCount }
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
    console.log('[useConversations] New message received:', {
      conversation_id: newMessage.conversation_id,
      sender_id: newMessage.sender_id,
      recipient_id: newMessage.recipient_id,
      current_user_id: userId
    });

    if (!newMessage.conversation_id) {
      // New conversation - need to fetch it
      console.log('[useConversations] No conversation_id, fetching conversations...');
      if (fetchConversationsRef.current) {
        fetchConversationsRef.current();
      }
      return;
    }

    // Get sender profile from cache or fetch it first
    let senderProfile = profilesCacheRef.current.get(newMessage.sender_id);
    
    if (!senderProfile) {
      // Fetch sender profile synchronously if not in cache
      console.log('[useConversations] Fetching sender profile:', newMessage.sender_id);
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', newMessage.sender_id)
        .single();
      
      if (data) {
        senderProfile = data;
        profilesCacheRef.current.set(newMessage.sender_id, data);
      }
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

    // Update the conversation list
    setConversations(prev => {
      // Find the conversation
      const convIndex = prev.findIndex(c => c.id === newMessage.conversation_id);
      
      if (convIndex === -1) {
        // Conversation not in list yet - might be a new conversation
        console.log('[useConversations] Conversation not found in list, fetching...');
        // Fetch to get the full conversation data
        if (fetchConversationsRef.current) {
          fetchConversationsRef.current();
        }
        return prev;
      }

      // Update the conversation
      const updated = [...prev];
      const conv = updated[convIndex];
      
      const isRecipient = newMessage.recipient_id === userId;
      const isSender = newMessage.sender_id === userId;
      
      // Use ref for base count to prevent stacking
      const baseCount = unreadCountByConvRef.current.get(newMessage.conversation_id) ?? conv.unread_count;
      
      // Update unread count only if user is recipient and message is unread
      const newUnreadCount = isRecipient && !newMessage.is_read
        ? baseCount + 1
        : baseCount;
      
      // Update ref synchronously
      unreadCountByConvRef.current.set(newMessage.conversation_id, newUnreadCount);

      // Always update last_message and last_message_at for both sender and recipient
      // This ensures the conversation moves to the top of the list
      updated[convIndex] = {
        ...conv,
        last_message: messageAsLastMessage,
        last_message_at: newMessage.created_at,
        unread_count: newUnreadCount
      };

      console.log('[useConversations] Updated conversation:', {
        conversation_id: newMessage.conversation_id,
        isSender,
        isRecipient,
        newUnreadCount,
        last_message_at: newMessage.created_at
      });

      // Re-sort by last_message_at (most recent first)
      const sorted = updated.sort((a, b) => {
        const timeA = new Date(a.last_message_at).getTime();
        const timeB = new Date(b.last_message_at).getTime();
        return timeB - timeA;
      });

      return sorted;
    });
  };

  // Keep subscription callback refs current so realtime always uses latest state/updaters
  optimisticallyUpdateConversationWithMessageRef.current = optimisticallyUpdateConversationWithMessage;
  optimisticallyUpdateUnreadCountRef.current = optimisticallyUpdateUnreadCount;

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
    updateUnreadCount,
    subscriptionStatus // Expose subscription status for UI indicators
  };
}

