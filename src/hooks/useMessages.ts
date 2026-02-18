import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { MessageWithDetails, MessageAttachment } from '../types';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseMessagesOptions {
  conversationId: string | null;
  userId: string;
  limit?: number;
  onUnreadCountUpdate?: (conversationId: string, newCount: number) => void;
}

type SubscriptionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useMessages({ conversationId, userId, limit = 50, onUnreadCountUpdate }: UseMessagesOptions) {
  const [messages, setMessages] = useState<MessageWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>('disconnected');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasMarkedAsReadRef = useRef<string | null>(null); // Track which conversation we've marked as read
  // Cache messages by conversation ID for instant switching
  const messagesCacheRef = useRef<Map<string, MessageWithDetails[]>>(new Map());
  const hasMoreCacheRef = useRef<Map<string, boolean>>(new Map());
  // Track current channel for cleanup
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Track retry attempts
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  // Track if retry is in progress to prevent concurrent retries
  const isRetryingRef = useRef(false);

  // Memoized message checker to avoid duplicates
  const messageExistsRef = useRef<Set<string>>(new Set());

  // Update the message existence set when messages change
  useEffect(() => {
    messageExistsRef.current = new Set(messages.map(m => m.id));
  }, [messages]);

  // Subscribe to realtime with retry logic
  const setupSubscription = useCallback(async (convId: string) => {
    // Validate session before subscribing
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.warn('[Realtime] No valid session, skipping subscription');
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

    // Create unique channel name with timestamp to avoid conflicts
    const channelName = `messages-${convId}-${Date.now()}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${convId}`
        },
        (payload) => {
          console.log('[Realtime] New message received:', payload.new);
          const newMessage = payload.new as { 
            id: string; 
            sender_id: string; 
            recipient_id: string; 
            is_read: boolean; 
            conversation_id: string | null;
            content?: string;
            created_at?: string;
          };
          handleNewMessage(newMessage);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${convId}`
        },
        (payload) => {
          console.log('[Realtime] Message updated:', payload.new);
          updateMessage(payload.new as { id: string; [key: string]: unknown });
        }
      )
      .subscribe(async (status, err) => {
        console.log(`[Realtime] Subscription status for ${convId}:`, status, err || '');
        
        if (status === 'SUBSCRIBED') {
          setSubscriptionStatus('connected');
          retryCountRef.current = 0; // Reset retry count on success
          isRetryingRef.current = false; // Reset retry flag
          console.log(`[Realtime] Successfully subscribed to messages for conversation ${convId}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setSubscriptionStatus('error');
          
          // Safely handle undefined err parameter
          const errorMessage = err?.message || (err && typeof err === 'object' ? JSON.stringify(err) : String(err)) || 'Unknown error';
          const errorDetails = err ? JSON.stringify(err, null, 2) : 'No error details available';
          
          console.error(`[Realtime] Error subscribing to messages for conversation ${convId}:`, {
            status,
            error: errorMessage,
            details: errorDetails,
            channelName,
            conversationId: convId,
            retryCount: retryCountRef.current
          });
          
          // Prevent concurrent retry attempts
          if (isRetryingRef.current) {
            console.log('[Realtime] Retry already in progress, skipping');
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
            
            console.log(`[Realtime] Retrying subscription (attempt ${retryCountRef.current}/${maxRetries}) in ${Math.round(delay)}ms...`);
            
            setTimeout(async () => {
              // Re-check session before retrying
              const { data: { session: retrySession } } = await supabase.auth.getSession();
              if (!retrySession) {
                console.warn('[Realtime] Session expired during retry, aborting');
                isRetryingRef.current = false;
                setSubscriptionStatus('disconnected');
                return;
              }
              
              isRetryingRef.current = false;
              await setupSubscription(convId);
            }, delay);
          } else {
            isRetryingRef.current = false;
            console.error('[Realtime] Max retries reached. Subscription failed.');
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
    if (!conversationId || !userId) {
      setMessages([]);
      setLoading(false);
      setSubscriptionStatus('disconnected');
      return;
    }

    // Check cache first - if we have cached messages, show them immediately
    const cachedMessages = messagesCacheRef.current.get(conversationId);
    if (cachedMessages && cachedMessages.length > 0) {
      setMessages(cachedMessages);
      setHasMore(hasMoreCacheRef.current.get(conversationId) ?? false);
      setLoading(false);
    }

    // Always fetch fresh messages (will update cache and state)
    fetchMessages();

    // Set up real-time subscription with retry logic
    retryCountRef.current = 0;
    isRetryingRef.current = false;
    setupSubscription(conversationId);

    return () => {
      // Clean up channel on unmount or conversation change
      if (channelRef.current) {
        console.log(`[Realtime] Cleaning up subscription for conversation ${conversationId}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, userId, setupSubscription]);

  // Reset flag when conversation changes
  useEffect(() => {
    if (conversationId) {
      hasMarkedAsReadRef.current = null;
    }
  }, [conversationId]);

  // Mark messages as read when messages are loaded (only once per conversation)
  useEffect(() => {
    if (!conversationId || !userId) {
      return;
    }

    // Wait until messages are loaded
    if (messages.length === 0) {
      return;
    }

    // Only mark as read if we haven't already done so for this conversation
    if (hasMarkedAsReadRef.current === conversationId) {
      console.log('Already marked messages as read for conversation:', conversationId);
      return; // Already marked as read for this conversation
    }

    // Check if there are unread messages for this user
    const unreadMessages = messages.filter(
      msg => msg.conversation_id === conversationId && msg.recipient_id === userId && !msg.is_read
    );
    
    if (unreadMessages.length > 0) {
      console.log(`Found ${unreadMessages.length} unread messages, marking as read...`);
      markMessagesAsRead();
    } else {
      // No unread messages, but mark as processed and sync with conversation list
      console.log('No unread messages, marking conversation as processed');
      hasMarkedAsReadRef.current = conversationId;
      // Clear the badge in conversation list even when there's nothing to mark as read
      if (onUnreadCountUpdate) {
        onUnreadCountUpdate(conversationId, 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length, userId]); // Run when conversation changes or messages are loaded

  // Initial load: fetch the most recent 50 messages (newest first from API, then reverse for chronological display)
  const fetchMessages = async () => {
    if (!conversationId) return;

    const cachedMessages = messagesCacheRef.current.get(conversationId);
    const cachedHasMore = hasMoreCacheRef.current.get(conversationId);
    const isInitialLoad = !cachedMessages;

    try {
      if (isInitialLoad) {
        setLoading(true);
      }
      setError(null);

      if (cachedMessages && cachedMessages.length > 0) {
        setMessages(cachedMessages);
        setHasMore(cachedHasMore ?? false);
        setLoading(false);
      }

      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useMessages.ts:fetchMessages',message:'Initial fetch result',data:{conversationId,requestedLimit:limit,returnedCount:messagesData?.length ?? 0},timestamp:Date.now(),hypothesisId:'A,D'})}).catch(()=>{});
      // #endregion

      if (messagesError) {
        console.error('Error fetching messages:', messagesError);
        throw messagesError;
      }

      if (!messagesData || messagesData.length === 0) {
        setMessages([]);
        messagesCacheRef.current.set(conversationId, []);
        hasMoreCacheRef.current.set(conversationId, false);
        setHasMore(false);
        setLoading(false);
        return;
      }

      const enrichedMessages = await enrichMessages(messagesData);
      // Reverse so state is chronological (oldest of the 50 first, newest last)
      const chronological = [...enrichedMessages].reverse();

      const newHasMore = messagesData.length === limit;
      messagesCacheRef.current.set(conversationId, chronological);
      hasMoreCacheRef.current.set(conversationId, newHasMore);
      setMessages(chronological);
      setHasMore(newHasMore);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useMessages.ts:setMessages',message:'State set after initial load',data:{count:chronological.length,hasMore:newHasMore},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } catch (err) {
      console.error('Error fetching messages:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
      if (!cachedMessages) {
        setLoading(false);
      }
    } finally {
      setLoading(false);
    }
  };

  // Load 50 messages older than the given timestamp (cursor-based); prepend to current list
  const fetchOlderMessages = async (beforeCreatedAt: string) => {
    if (!conversationId) return;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useMessages.ts:fetchOlderMessages',message:'Load older called',data:{conversationId,beforeCreatedAt},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    try {
      setLoading(true);
      setError(null);

      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .lt('created_at', beforeCreatedAt)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (messagesError) {
        console.error('Error fetching older messages:', messagesError);
        throw messagesError;
      }

      if (!messagesData || messagesData.length === 0) {
        setHasMore(false);
        hasMoreCacheRef.current.set(conversationId, false);
        setLoading(false);
        return;
      }

      const enrichedMessages = await enrichMessages(messagesData);
      const olderReversed = [...enrichedMessages].reverse();

      const newHasMore = messagesData.length === limit;
      setMessages(prev => {
        const next = [...olderReversed, ...prev];
        messagesCacheRef.current.set(conversationId, next);
        return next;
      });
      hasMoreCacheRef.current.set(conversationId, newHasMore);
      setHasMore(newHasMore);
    } catch (err) {
      console.error('Error fetching older messages:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch older messages');
    } finally {
      setLoading(false);
    }
  };

  // Shared helper to enrich raw messages with profiles and attachments
  const enrichMessages = async (messagesData: { id: string; sender_id: string; recipient_id: string; [key: string]: unknown }[]): Promise<MessageWithDetails[]> => {
    const senderIds = [...new Set(messagesData.map(m => m.sender_id))];
    const recipientIds = [...new Set(messagesData.map(m => m.recipient_id))];
    const profileIds = [...new Set([...senderIds, ...recipientIds])];

    const { data: profilesData } = await supabase
      .from('user_profiles')
      .select('*')
      .in('id', profileIds);
    const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

    const messageIds = messagesData.map(m => m.id);
    const { data: attachmentsData } = await supabase
      .from('message_attachments')
      .select('*')
      .in('message_id', messageIds);
    const attachmentsMap = new Map<string, MessageAttachment[]>();
    attachmentsData?.forEach(att => {
      if (!attachmentsMap.has(att.message_id)) {
        attachmentsMap.set(att.message_id, []);
      }
      attachmentsMap.get(att.message_id)!.push(att);
    });

    return messagesData.map(msg => ({
      ...msg,
      sender: profilesMap.get(msg.sender_id) || null,
      recipient: profilesMap.get(msg.recipient_id) || null,
      attachments: attachmentsMap.get(msg.id) || []
    })) as MessageWithDetails[];
  };

  // Handle new message from realtime subscription
  const handleNewMessage = async (newMessage: { id: string; sender_id: string; recipient_id: string; is_read: boolean; conversation_id: string | null; content?: string; created_at?: string }) => {
    // Skip if this is a temporary optimistic message (will be replaced by real one)
    if (newMessage.id.startsWith('temp-')) {
      console.log('[Realtime] Skipping temp message:', newMessage.id);
      return;
    }

    // Early duplicate check using the ref (fast, synchronous)
    if (messageExistsRef.current.has(newMessage.id)) {
      console.log('[Realtime] Message already exists, skipping:', newMessage.id);
      return;
    }

    // Add to tracking set immediately to prevent race conditions
    messageExistsRef.current.add(newMessage.id);

    console.log('[Realtime] Processing new message:', newMessage.id);

    // Fetch message details and profiles in parallel for speed
    const [messageResult, profilesResult] = await Promise.all([
      supabase
        .from('messages')
        .select('*')
        .eq('id', newMessage.id)
        .single(),
      supabase
        .from('user_profiles')
        .select('*')
        .in('id', [newMessage.sender_id, newMessage.recipient_id].filter(Boolean))
    ]);

    // If message fetch failed, try to use payload data
    const messageData = messageResult.data || {
      id: newMessage.id,
      organization_id: null,
      conversation_id: newMessage.conversation_id,
      sender_id: newMessage.sender_id,
      recipient_id: newMessage.recipient_id,
      appointment_id: null,
      subject: null,
      content: newMessage.content || '',
      is_read: newMessage.is_read || false,
      created_at: newMessage.created_at || new Date().toISOString()
    };

    if (messageResult.error && !messageResult.data) {
      console.error('[Realtime] Error fetching new message details:', messageResult.error);
      // Still try to show message with basic data
    }

    const profilesMap = new Map(profilesResult.data?.map(p => [p.id, p]) || []);

    // Get profiles - use existing messages' profiles as fallback if not found
    let senderProfile = profilesMap.get(newMessage.sender_id);
    let recipientProfile = profilesMap.get(newMessage.recipient_id);

    // If profiles not found, try to get from existing messages in this conversation
    if (!senderProfile || !recipientProfile) {
      // Get current messages synchronously to find profiles
      const currentMessages = messagesCacheRef.current.get(conversationId || '') || [];
      const existingMsg = currentMessages.find(m => 
        m.sender_id === newMessage.sender_id || m.recipient_id === newMessage.recipient_id
      );
      if (existingMsg) {
        if (!senderProfile && existingMsg.sender_id === newMessage.sender_id) {
          senderProfile = existingMsg.sender;
        }
        if (!recipientProfile && existingMsg.recipient_id === newMessage.recipient_id) {
          recipientProfile = existingMsg.recipient;
        }
      }
    }

    // If still no profiles, fetch them (shouldn't happen often)
    if (!senderProfile || !recipientProfile) {
      const { data: missingProfiles } = await supabase
        .from('user_profiles')
        .select('*')
        .in('id', [newMessage.sender_id, newMessage.recipient_id].filter(Boolean));
      
      missingProfiles?.forEach(p => {
        if (p.id === newMessage.sender_id && !senderProfile) {
          senderProfile = p;
        }
        if (p.id === newMessage.recipient_id && !recipientProfile) {
          recipientProfile = p;
        }
      });
    }

    // Fetch attachments in background (non-blocking)
    const attachmentsPromise = supabase
      .from('message_attachments')
      .select('*')
      .eq('message_id', newMessage.id)
      .then(({ data }) => data || []);

    // Create enriched message
    const enrichedMessage: MessageWithDetails = {
      ...messageData,
      sender: senderProfile!,
      recipient: recipientProfile!,
      attachments: [] // Will be updated when attachments load
    };

    // Add message immediately (instant UI update)
    setMessages(prev => {
      // Final duplicate check (state might have updated since our ref check)
      if (prev.some(msg => msg.id === newMessage.id)) {
        console.log('[Realtime] Message already in state, skipping:', newMessage.id);
        return prev;
      }

      // Find and remove any temp messages from this sender with similar content
      // This handles the optimistic update replacement
      const tempMessagesToRemove = prev.filter(msg => 
        msg.id.startsWith('temp-') && 
        msg.sender_id === newMessage.sender_id &&
        msg.content === enrichedMessage.content
      );
      
      if (tempMessagesToRemove.length > 0) {
        console.log('[Realtime] Replacing optimistic message(s):', tempMessagesToRemove.map(m => m.id));
      }
      
      const filtered = prev.filter(msg => !tempMessagesToRemove.includes(msg));
      const updated = [...filtered, enrichedMessage];
      const sorted = updated.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      // Update cache
      if (conversationId) {
        messagesCacheRef.current.set(conversationId, sorted);
      }
      
      console.log('[Realtime] Message added to state:', newMessage.id);
      return sorted;
    });

    // Scroll to bottom immediately
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    // Update with attachments when they load
    try {
      const attachments = await attachmentsPromise;
      if (attachments.length > 0) {
        setMessages(prev => {
          const updated = prev.map(msg => 
            msg.id === newMessage.id
              ? { ...msg, attachments }
              : msg
          );
          
          // Update cache
          if (conversationId) {
            messagesCacheRef.current.set(conversationId, updated);
          }
          
          return updated;
        });
      }
    } catch (err) {
      console.error('[Realtime] Error fetching attachments:', err);
      // Message already shown, so continue
    }

    // Mark as read if not sent by current user
    if (newMessage.recipient_id === userId && !newMessage.is_read) {
      markMessageAsRead(newMessage.id);
    }
  };

  // Add message optimistically (for instant UI feedback when sending)
  const addMessage = (message: MessageWithDetails) => {
    setMessages(prev => {
      // Check if message already exists
      if (prev.some(msg => msg.id === message.id)) {
        return prev; // Already exists, don't duplicate
      }
      
      // Add message and sort by created_at
      const updated = [...prev, message];
      const sorted = updated.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      // Update cache for this conversation
      if (conversationId) {
        messagesCacheRef.current.set(conversationId, sorted);
      }
      
      return sorted;
    });

    // Scroll to bottom
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const updateMessage = (updatedMessage: { id: string; [key: string]: unknown }) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.id === updatedMessage.id 
          ? { ...msg, ...updatedMessage }
          : msg
      )
    );
  };

  const markMessagesAsRead = async () => {
    if (!conversationId || !userId) {
      console.log('markMessagesAsRead: Missing conversationId or userId', { conversationId, userId });
      return;
    }

    // Prevent multiple simultaneous calls for the same conversation
    if (hasMarkedAsReadRef.current === conversationId) {
      console.log('markMessagesAsRead: Already marked as read for this conversation');
      return;
    }

    // Count unread messages before marking
    const unreadCount = messages.filter(
      msg => msg.conversation_id === conversationId && msg.recipient_id === userId && !msg.is_read
    ).length;

    if (unreadCount === 0) {
      console.log('markMessagesAsRead: No unread messages to mark');
      hasMarkedAsReadRef.current = conversationId;
      return;
    }

    console.log(`markMessagesAsRead: Marking ${unreadCount} messages as read for conversation ${conversationId}`);

    // Set the flag immediately to prevent concurrent calls
    hasMarkedAsReadRef.current = conversationId;

    try {
      // First, update the local state immediately for responsive UI
      setMessages(prev => {
        const updated = prev.map(msg => 
          msg.conversation_id === conversationId && msg.recipient_id === userId && !msg.is_read
            ? { ...msg, is_read: true }
            : msg
        );
        
        // Update cache for this conversation
        if (conversationId) {
          messagesCacheRef.current.set(conversationId, updated);
        }
        
        return updated;
      });

      // Optimistically update unread count in conversation list (instantly remove badge)
      if (onUnreadCountUpdate && conversationId) {
        onUnreadCountUpdate(conversationId, 0);
      }

      // Then update in the database
      const { data, error } = await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .eq('recipient_id', userId)
        .eq('is_read', false)
        .select('id');

      if (error) {
        console.error('Error marking messages as read:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        console.error('RLS policy issue? Check UPDATE policy on messages table');
        // Revert local state on error
        setMessages(prev => {
          const reverted = prev.map(msg => 
            msg.conversation_id === conversationId && msg.recipient_id === userId && msg.is_read
              ? { ...msg, is_read: false }
              : msg
          );
          
          // Update cache for this conversation
          if (conversationId) {
            messagesCacheRef.current.set(conversationId, reverted);
          }
          
          return reverted;
        });
        // Revert unread count on error (restore badge if update failed)
        if (onUnreadCountUpdate && conversationId) {
          onUnreadCountUpdate(conversationId, unreadCount);
        }
        hasMarkedAsReadRef.current = null; // Reset flag on error so we can retry
      } else {
        console.log(`Successfully marked ${data?.length || 0} messages as read`);
      }
    } catch (err) {
      console.error('Error marking messages as read:', err);
      hasMarkedAsReadRef.current = null; // Reset flag on error so we can retry
    }
  };

  const markMessageAsRead = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('id', messageId);

      if (!error) {
        // Update local state immediately
        setMessages(prev => 
          prev.map(msg => 
            msg.id === messageId
              ? { ...msg, is_read: true }
              : msg
          )
        );
      }
    } catch (err) {
      console.error('Error marking message as read:', err);
    }
  };

  const loadMoreMessages = () => {
    if (!loading && hasMore && messages.length > 0) {
      fetchOlderMessages(messages[0].created_at);
    }
  };

  return {
    messages,
    loading,
    error,
    hasMore,
    messagesEndRef,
    loadMoreMessages,
    markMessagesAsRead,
    addMessage,
    refetch: () => fetchMessages(),
    subscriptionStatus // Expose subscription status for UI indicators
  };
}

