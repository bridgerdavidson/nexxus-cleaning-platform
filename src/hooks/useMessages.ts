import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { MessageWithDetails, MessageAttachment } from '../types';

interface UseMessagesOptions {
  conversationId: string | null;
  userId: string;
  limit?: number;
  onUnreadCountUpdate?: (conversationId: string, newCount: number) => void;
}

export function useMessages({ conversationId, userId, limit = 50, onUnreadCountUpdate }: UseMessagesOptions) {
  const [messages, setMessages] = useState<MessageWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasMarkedAsReadRef = useRef<string | null>(null); // Track which conversation we've marked as read
  // Cache messages by conversation ID for instant switching
  const messagesCacheRef = useRef<Map<string, MessageWithDetails[]>>(new Map());
  const hasMoreCacheRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (!conversationId || !userId) {
      setMessages([]);
      setLoading(false);
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

    // Set up real-time subscription
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          addNewMessage(payload.new as { id: string; sender_id: string; recipient_id: string; is_read: boolean; conversation_id: string | null });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          updateMessage(payload.new as { id: string; [key: string]: unknown });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, userId]);

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
      // No unread messages, but mark as processed
      console.log('No unread messages, marking conversation as processed');
      hasMarkedAsReadRef.current = conversationId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length, userId]); // Run when conversation changes or messages are loaded

  const fetchMessages = async (offset = 0) => {
    if (!conversationId) return;

    // Check cache first for instant display
    const cachedMessages = messagesCacheRef.current.get(conversationId);
    const cachedHasMore = hasMoreCacheRef.current.get(conversationId);
    const isInitialLoad = offset === 0 && !cachedMessages;

    try {
      // Only show loading for initial loads (not cached conversations)
      if (isInitialLoad) {
        setLoading(true);
      }
      setError(null);

      // If we have cached messages and this is initial load, show them instantly
      if (cachedMessages && offset === 0) {
        setMessages(cachedMessages);
        setHasMore(cachedHasMore ?? false);
        setLoading(false);
        // Continue to fetch fresh messages in background (optional refresh)
      }

      // Fetch messages for this conversation
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);

      if (messagesError) {
        console.error('Error fetching messages:', messagesError);
        throw messagesError;
      }

      if (!messagesData || messagesData.length === 0) {
        if (offset === 0) {
          setMessages([]);
          messagesCacheRef.current.set(conversationId, []);
          setHasMore(false);
          hasMoreCacheRef.current.set(conversationId, false);
        }
        setLoading(false);
        return;
      }

      // Get unique sender and recipient IDs
      const senderIds = [...new Set(messagesData.map(m => m.sender_id))];
      const recipientIds = [...new Set(messagesData.map(m => m.recipient_id))];
      const profileIds = [...new Set([...senderIds, ...recipientIds])];

      // Fetch profiles separately
      const { data: profilesData, error: profilesError } = await supabase
        .from('user_profiles')
        .select('*')
        .in('id', profileIds);

      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
        // Continue without profiles rather than failing completely
      }

      // Map profiles by ID
      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

      // Fetch attachments for these messages
      const messageIds = messagesData.map(m => m.id);
      const { data: attachmentsData, error: attachmentsError } = await supabase
        .from('message_attachments')
        .select('*')
        .in('message_id', messageIds);

      if (attachmentsError) {
        console.error('Error fetching attachments:', attachmentsError);
        // Continue without attachments rather than failing completely
      }

      // Map attachments by message_id
      const attachmentsMap = new Map<string, MessageAttachment[]>();
      attachmentsData?.forEach(att => {
        if (!attachmentsMap.has(att.message_id)) {
          attachmentsMap.set(att.message_id, []);
        }
        attachmentsMap.get(att.message_id)!.push(att);
      });

      // Combine data
      const enrichedMessages: MessageWithDetails[] = messagesData.map(msg => ({
        ...msg,
        sender: profilesMap.get(msg.sender_id) || null,
        recipient: profilesMap.get(msg.recipient_id) || null,
        attachments: attachmentsMap.get(msg.id) || []
      }));

      if (offset === 0) {
        // Update cache and state
        messagesCacheRef.current.set(conversationId, enrichedMessages);
        hasMoreCacheRef.current.set(conversationId, messagesData.length === limit);
        setMessages(enrichedMessages);
        setHasMore(messagesData.length === limit);
      } else {
        // For pagination, append to existing messages
        const updatedMessages = [...enrichedMessages, ...messages];
        messagesCacheRef.current.set(conversationId, updatedMessages);
        setMessages(updatedMessages);
        setHasMore(messagesData.length === limit);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
      // If we have cached messages and fetch fails, keep showing cached
      if (!cachedMessages) {
        setLoading(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const addNewMessage = async (newMessage: { id: string; sender_id: string; recipient_id: string; is_read: boolean; conversation_id: string | null }) => {
    // Skip if this is a temporary optimistic message (will be replaced by real one)
    if (newMessage.id.startsWith('temp-')) {
      return;
    }

    // Fetch message without joins
    const { data: messageData, error: messageError } = await supabase
      .from('messages')
      .select('*')
      .eq('id', newMessage.id)
      .single();

    if (messageError) {
      console.error('Error fetching new message:', messageError);
      return;
    }

    // Fetch sender and recipient profiles
    const profileIds = [messageData.sender_id, messageData.recipient_id].filter(Boolean);
    const { data: profilesData } = await supabase
      .from('user_profiles')
      .select('*')
      .in('id', profileIds);

    const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);

    // Fetch attachments
    const { data: attachmentsData } = await supabase
      .from('message_attachments')
      .select('*')
      .eq('message_id', newMessage.id);

    const enrichedMessage: MessageWithDetails = {
      ...messageData,
      sender: profilesMap.get(messageData.sender_id) || null,
      recipient: profilesMap.get(messageData.recipient_id) || null,
      attachments: attachmentsData || []
    };

    // Check if message already exists (from optimistic update with temp ID)
    // Or if we have a temp message from the same sender with similar content
    setMessages(prev => {
      // Remove any temp messages from this sender around the same time
      const tempMessages = prev.filter(msg => 
        msg.id.startsWith('temp-') && 
        msg.sender_id === enrichedMessage.sender_id &&
        msg.content === enrichedMessage.content
      );
      
      // If we have temp messages, remove them and add the real one
      if (tempMessages.length > 0) {
        const filtered = prev.filter(msg => !tempMessages.includes(msg));
        const updated = [...filtered, enrichedMessage];
        const sorted = updated.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        // Update cache for this conversation
        if (conversationId) {
          messagesCacheRef.current.set(conversationId, sorted);
        }
        
        return sorted;
      }

      // Check if message with same ID already exists
      const existingIndex = prev.findIndex(msg => msg.id === enrichedMessage.id);
      if (existingIndex >= 0) {
        // Update existing message
        const updated = [...prev];
        updated[existingIndex] = enrichedMessage;
        const sorted = updated.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        // Update cache for this conversation
        if (conversationId) {
          messagesCacheRef.current.set(conversationId, sorted);
        }
        
        return sorted;
      } else {
        // Add new message
        const updated = [...prev, enrichedMessage];
        const sorted = updated.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        // Update cache for this conversation
        if (conversationId) {
          messagesCacheRef.current.set(conversationId, sorted);
        }
        
        return sorted;
      }
    });

    // Mark as read if not sent by current user
    if (newMessage.recipient_id === userId && !newMessage.is_read) {
      markMessageAsRead(newMessage.id);
    }

    // Scroll to bottom
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
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
    if (!loading && hasMore) {
      fetchMessages(messages.length);
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
    refetch: () => fetchMessages(0)
  };
}

