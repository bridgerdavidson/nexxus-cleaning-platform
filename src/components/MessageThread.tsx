import React, { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
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
  // Top sentinel observed to fetch the previous page just before the user
  // reaches the top of the thread (iOS-style incremental paging).
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  // Scroll-anchor baseline captured before an older-page prepend so the
  // viewport can be held steady on the message the user is reading.
  const pendingPrependRef = useRef<{ height: number; top: number } | null>(null);
  // Track if user is near bottom for smart auto-scroll
  const isNearBottomRef = useRef(true);
  // Track previous message count to detect new messages
  const prevMessageCountRef = useRef(0);
  // Initial-open reveal gate: hold the thread hidden until its images have
  // loaded, then show it already pinned to the bottom (no scroll animation).
  const [revealed, setRevealed] = useState(false);
  const revealedRef = useRef(false);
  const expectedImagesRef = useRef(0);
  const loadedImagesRef = useRef(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const {
    messages,
    loading,
    hasMore,
    isLoadingMore,
    messagesEndRef,
    loadMoreMessages,
    addMessage,
  } = useMessages({
    conversationId: conversation?.id || null,
    userId: currentUserId,
    onUnreadCountUpdate,
  });
  const { sendMessage, sending } = useSendMessage();
  const { user } = useAuth();

  // Helper to check if user is near the bottom of the scroll container
  const checkIfNearBottom = useCallback(() => {
    if (!scrollContainerRef.current) return true;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Consider "near bottom" if within 150px of the bottom
    const threshold = 150;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, []);

  // Update the isNearBottom ref on scroll
  const updateScrollPosition = useCallback(() => {
    isNearBottomRef.current = checkIfNearBottom();
  }, [checkIfNearBottom]);

  // Jump to the bottom instantly. No smooth behavior anywhere: the animated
  // scroll used to run before images had height and landed above the fold, so
  // we removed it in favor of an instant jump + the reveal gate below.
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || el.scrollHeight === 0) return;
    requestAnimationFrame(() => {
      const node = scrollContainerRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, []);

  const reveal = useCallback(() => {
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    scrollToBottom();
    revealedRef.current = true;
    setRevealed(true);
  }, [scrollToBottom]);

  // Reset the reveal gate whenever the conversation changes.
  useEffect(() => {
    revealedRef.current = false;
    setRevealed(false);
    loadedImagesRef.current = 0;
    expectedImagesRef.current = 0;
    prevMessageCountRef.current = 0;
    pendingPrependRef.current = null;
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, [conversation?.id]);

  // Initial open: once the first page of messages has loaded, wait for their
  // images to finish before revealing the thread already pinned to the bottom.
  // A timeout guards against a slow or broken image hanging the view.
  useEffect(() => {
    if (revealedRef.current) return;
    if (loading) return;
    if (messages.length === 0) {
      // Nothing to load or an empty conversation: reveal right away.
      reveal();
      return;
    }
    const expected = messages.reduce(
      (n, m) => n + (m.attachments?.length ?? 0),
      0,
    );
    expectedImagesRef.current = expected;
    isNearBottomRef.current = true;
    if (expected === 0) {
      reveal();
      return;
    }
    // Cached images may have fired onLoad before this effect set the count.
    if (loadedImagesRef.current >= expected) {
      reveal();
      return;
    }
    // Pin to the current bottom now (behind the loader), then reveal when the
    // images settle (handleImageLoad) or the safety timeout fires.
    scrollToBottom();
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(reveal, 600);
  }, [conversation?.id, loading, messages, reveal, scrollToBottom]);

  // After the thread is revealed, keep it pinned to the bottom when new
  // messages arrive and the user is already near the bottom.
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (!revealedRef.current) return;
    if (messages.length > prevCount && isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages.length, scrollToBottom]);

  // Each attachment image calls this when it settles (load or error). During
  // the initial reveal gate it advances the loaded count and reveals as soon as
  // every image has settled; afterward it re-pins to the bottom so a
  // late-arriving image doesn't push the latest message below the fold. Only
  // re-pins when the user is already near the bottom (preserves scroll-up).
  const handleImageLoad = useCallback(() => {
    loadedImagesRef.current += 1;
    if (
      !revealedRef.current &&
      expectedImagesRef.current > 0 &&
      loadedImagesRef.current >= expectedImagesRef.current
    ) {
      reveal();
      return;
    }
    if (!revealedRef.current) return;
    if (!isNearBottomRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const node = scrollContainerRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, [reveal]);

  // Fetch the previous page and hold the viewport anchored on the message the
  // user is reading. Capture the scroll metrics BEFORE the prepend; the
  // useLayoutEffect below restores the position once the older messages render.
  const handleLoadMore = useCallback(async () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // A non-null pendingPrependRef means a load is already in flight (it stays
    // set from capture until the layout effect restores the anchor). Bail
    // before overwriting it: a re-entrant call would otherwise capture a fresh
    // baseline and then clear it (loadMoreMessages returns 0 under the hook's
    // re-entrancy guard), stranding the in-flight load with no anchor to
    // restore and reintroducing the jump.
    if (pendingPrependRef.current) return;
    pendingPrependRef.current = { height: el.scrollHeight, top: el.scrollTop };
    const added = await loadMoreMessages();
    if (added === 0) {
      // Nothing prepended: no height change to compensate for.
      pendingPrependRef.current = null;
    }
  }, [loadMoreMessages]);

  // Keep handleLoadMore reachable from the IntersectionObserver without making
  // it re-subscribe each time the callback identity changes.
  const handleLoadMoreRef = useRef(handleLoadMore);
  useEffect(() => {
    handleLoadMoreRef.current = handleLoadMore;
  }, [handleLoadMore]);

  // After older messages prepend, restore scrollTop by the exact height added
  // above the viewport so the thread doesn't jump. Runs before paint
  // (useLayoutEffect) so the shift is never visible. The append/new-message
  // path leaves pendingPrependRef null, so it is untouched here.
  useLayoutEffect(() => {
    const pending = pendingPrependRef.current;
    if (!pending) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = pending.top + (el.scrollHeight - pending.height);
    pendingPrependRef.current = null;
  }, [messages.length]);

  // Observe the top sentinel: once it scrolls within ~200px of the top, fetch
  // the previous page. Only active after the initial reveal and while there is
  // more to load. With the anchor restore above, each load pushes the sentinel
  // back out of view, so paging is one batch per scroll-up (no cascade).
  useEffect(() => {
    if (!revealed || !hasMore) return;
    const root = scrollContainerRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          void handleLoadMoreRef.current();
        }
      },
      { root, rootMargin: "200px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [revealed, hasMore, conversation?.id]);

  const handleScroll = () => {
    // Track near-bottom state for smart auto-scroll on new messages. Paging is
    // driven by the IntersectionObserver above, not a scroll-position check.
    updateScrollPosition();
  };

  const handleSendMessage = async (content: string, attachments: File[]) => {
    if (!conversation || !user) return;

    // Text-only sends: optimistically inject the bubble for instant feedback.
    // Sends WITH attachments skip the optimistic insert — the Send button
    // spinner carries the loading state, and `useSendMessage.onSuccess`
    // injects the fully-formed bubble (text + images + timestamp + check)
    // in one go when the uploads finish. This avoids the chunky flow where
    // the text/timestamp appeared first and images popped in afterward.
    if (attachments.length === 0) {
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const now = new Date().toISOString();

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
        attachments: [],
      };

      addMessage(optimisticMessage);
    }

    await sendMessage({
      conversationId: conversation.id,
      senderId: currentUserId,
      recipientId: conversation.other_participant.id,
      content,
      attachments,
    });
  };

  // Empty state - no conversation selected
  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
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
      <div className="flex-1 flex items-center justify-center bg-white">
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
      <div className="flex-shrink-0 px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 bg-white">
        {/* Unified layout (left-justified) */}
        <div className="flex items-center space-x-3 ml-12 md:ml-0">
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
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {other_participant.first_name} {other_participant.last_name}
            </h3>
            <p className="text-xs text-gray-500 capitalize">
              {other_participant.role}
            </p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 bg-white md:bg-gray-50 relative"
      >
        {/* Reveal gate: hold a spinner over the thread until its images have
            loaded, so it appears already scrolled to the bottom (no animation). */}
        {!revealed && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white md:bg-gray-50">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        )}

        {/* Loading-older indicator, pinned to the top of the visible area while
            the previous page is fetched. Absolute so it never shifts the thread
            (it stays out of the scroll flow and the anchor math). */}
        {revealed && isLoadingMore && (
          <div className="pointer-events-none absolute top-2 left-0 right-0 z-10 flex justify-center">
            <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-1.5 shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </span>
          </div>
        )}

        {/* Top sentinel: when it scrolls into view the previous page loads. */}
        <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px" />

        {/* No messages state */}
        {revealed && messages.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600">
                No messages yet. Start the conversation!
              </p>
            </div>
          </div>
        )}

        {/* Messages — rendered while hidden so images can load before reveal. */}
        <div className={revealed ? "" : "opacity-0"}>
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isSent={message.sender_id === currentUserId}
              onImageLoad={handleImageLoad}
            />
          ))}
        </div>

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <MessageInput onSend={handleSendMessage} disabled={sending} />
    </div>
  );
}
