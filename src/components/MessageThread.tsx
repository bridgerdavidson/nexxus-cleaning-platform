import React, { useEffect, useRef } from "react";
import { Loader2, ArrowUp, MessageSquare } from "lucide-react";
import { ConversationWithDetails, MessageWithDetails } from "../types";
import { useMessages } from "../hooks/useMessages";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import { useSendMessage } from "../hooks/useSendMessage";
import { useAuth } from "../hooks/useAuth";

interface MessageThreadProps {
  conversation: ConversationWithDetails | null;
  currentUserId: string;
  onUnreadCountUpdate?: (conversationId: string, newCount: number) => void;
}

export default function MessageThread({
  conversation,
  currentUserId,
  onUnreadCountUpdate,
}: MessageThreadProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    loading,
    hasMore,
    messagesEndRef,
    loadMoreMessages,
    markMessagesAsRead,
    addMessage,
  } = useMessages({
    conversationId: conversation?.id || null,
    userId: currentUserId,
    onUnreadCountUpdate,
  });
  const { sendMessage, sending } = useSendMessage();
  const { user } = useAuth();

  // Auto-scroll to bottom when new messages arrive or conversation changes
  useEffect(() => {
    if (scrollContainerRef.current && messages.length > 0) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          // Scroll within the container, not the page
          scrollContainerRef.current.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }
      });
    }
  }, [conversation?.id, messages.length]);

  const handleScroll = () => {
    if (!scrollContainerRef.current || loading || !hasMore) return;

    const { scrollTop } = scrollContainerRef.current;

    // If scrolled near the top, load more messages
    if (scrollTop < 100) {
      loadMoreMessages();
    }
  };

  const handleSendMessage = async (content: string, attachments: File[]) => {
    if (!conversation || !user) return;

    // Generate temporary ID for optimistic update
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const now = new Date().toISOString();

    // Construct sender profile from user data (matching UserProfile type)
    const senderProfile = {
      id: user.id,
      email: user.email,
      first_name: user.profile.firstName || null,
      last_name: user.profile.lastName || null,
      phone: user.profile.phone || null,
      role: user.role,
      avatar_url: user.profile.avatarUrl || null,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    };

    // Construct optimistic message
    const optimisticMessage: MessageWithDetails = {
      id: tempId,
      organization_id: null,
      conversation_id: conversation.id,
      sender_id: currentUserId,
      recipient_id: conversation.other_participant.id,
      appointment_id: null,
      subject: null,
      content: content.trim(),
      is_read: false,
      created_at: now,
      sender: senderProfile,
      recipient: conversation.other_participant,
      attachments: [], // Will be updated by real-time subscription if attachments exist
    };

    // Add message optimistically (instant UI feedback)
    addMessage(optimisticMessage);

    // Send message to backend
    const result = await sendMessage({
      conversationId: conversation.id,
      senderId: currentUserId,
      recipientId: conversation.other_participant.id,
      content,
      attachments,
    });

    // If sending fails, remove the optimistic message
    if (!result.success && result.error) {
      // Remove the optimistic message on failure
      // The real-time subscription won't fire, so we need to clean up
      // We'll handle this in addNewMessage by checking for temp IDs
    }
    // If successful, the real-time subscription will update with the real message ID
    // The addNewMessage function will replace the temp message with the real one
  };

  // Empty state - no conversation selected
  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No conversation selected
          </h3>
          <p className="text-sm text-gray-600">
            Choose a conversation from the list to start messaging
          </p>
        </div>
      </div>
    );
  }

  const { other_participant } = conversation;

  // Guard against missing participant
  if (!other_participant) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Conversation Error
          </h3>
          <p className="text-sm text-gray-600">
            Unable to load participant information
          </p>
        </div>
      </div>
    );
  }

  const getInitials = () => {
    const firstName = other_participant.first_name || "";
    const lastName = other_participant.last_name || "";
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || "?";
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 bg-white">
        {/* Mobile: Centered vertical stack */}
        <div className="flex flex-col items-center md:hidden">
          {/* Avatar */}
          {other_participant.avatar_url ? (
            <img
              src={other_participant.avatar_url}
              alt={`${other_participant.first_name} ${other_participant.last_name}`}
              className="w-12 h-12 rounded-full object-cover mb-2"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold text-sm mb-2">
              {getInitials()}
            </div>
          )}

          {/* Name */}
          <h3 className="font-semibold text-gray-900 mb-1 text-center">
            {other_participant.first_name} {other_participant.last_name}
          </h3>

          {/* Role */}
          <p className="text-sm text-gray-600 capitalize text-center">
            {other_participant.role}
          </p>
        </div>

        {/* Desktop: Horizontal layout (left-justified) */}
        <div className="hidden md:flex md:items-center md:space-x-3">
          {/* Avatar */}
          {other_participant.avatar_url ? (
            <img
              src={other_participant.avatar_url}
              alt={`${other_participant.first_name} ${other_participant.last_name}`}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold text-sm">
              {getInitials()}
            </div>
          )}

          {/* Name and role */}
          <div>
            <h3 className="font-semibold text-gray-900">
              {other_participant.first_name} {other_participant.last_name}
            </h3>
            <p className="text-sm text-gray-600 capitalize">
              {other_participant.role}
            </p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50"
      >
        {/* Load more indicator */}
        {hasMore && (
          <div className="flex justify-center mb-4">
            <button
              onClick={loadMoreMessages}
              disabled={loading}
              className="flex items-center space-x-2 px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  <ArrowUp className="w-4 h-4" />
                  <span>Load older messages</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && messages.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        )}

        {/* No messages state */}
        {!loading && messages.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600">
                No messages yet. Start the conversation!
              </p>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isSent={message.sender_id === currentUserId}
          />
        ))}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <MessageInput onSend={handleSendMessage} disabled={sending} />
    </div>
  );
}
