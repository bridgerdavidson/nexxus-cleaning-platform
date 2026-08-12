"use client";

import { useEffect, useRef, type RefObject } from "react";
import { MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import { ThreadHeader } from "./ThreadHeader";
import { LoadMoreSpinner, ThreadEmptyState, ThreadSkeleton } from "./ThreadStates";
import type { MessageVM } from "./messages-types";

export interface MessageThreadTakeoverViewProps {
  title: string;
  initials: string;
  avatarUrl: string | null;
  /** changes when the conversation changes, to reset the initial-scroll flag. */
  conversationKey: string | null;
  messages: MessageVM[];
  loading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  messagesEndRef: RefObject<HTMLDivElement>;
  onOpenBooking: (id: string) => void;
  composer: React.ComponentProps<typeof MessageComposer>;
  onBack?: () => void;
  /** Label shown next to the back chevron (e.g. "Back to job"). */
  backLabel?: string;
  /** When true the composer is replaced by a closed-thread notice (history stays readable). */
  readOnly?: boolean;
  readOnlyNotice?: string;
  /** Empty-state copy (defaults to the office wording). */
  emptyTitle?: string;
  emptyBody?: string;
}

/**
 * Shared full-screen takeover thread view. Reuses the operator MessageBubble + MessageComposer
 * and mirrors MessageThreadPanel's scroll/paging body, but with a trimmed header
 * (back + avatar + title only; no Details/Delete/role subtitle).
 *
 * Used by CleanerThread and HomeownerMessageThread.
 */
export function MessageThreadTakeoverView(props: MessageThreadTakeoverViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef(false);

  const { conversationKey, messages, messagesEndRef, hasMore, isLoadingMore, onLoadMore } = props;

  // Reset the initial-scroll flag whenever the conversation changes so the first
  // batch of messages for a new thread always jumps to the bottom.
  useEffect(() => {
    didInitialScrollRef.current = false;
    lastIdRef.current = null;
  }, [conversationKey]);

  // Paging: observe the top sentinel.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) onLoadMore();
      },
      { root: scrollRef.current, rootMargin: "200px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  // Auto-scroll: jump to latest on first load of a conversation; afterwards only
  // when a new trailing message arrives AND the user is near the bottom.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      lastIdRef.current = last.id;
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      return;
    }
    const isNew = last.id !== lastIdRef.current;
    lastIdRef.current = last.id;
    if (!isNew) return;
    const sc = scrollRef.current;
    if (!sc) return;
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 150;
    if (nearBottom) messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, messagesEndRef]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Trimmed header: back (takeover only) + avatar + title */}
      <ThreadHeader
        onBack={props.onBack}
        backLabel={props.backLabel}
        avatar={{ url: props.avatarUrl, initials: props.initials }}
        title={props.title}
      />

      {/* Message scroll area */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 py-4"
      >
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {props.isLoadingMore && <LoadMoreSpinner />}
        {/* Bottom-anchor spacer: pushes a short thread down to the composer, collapses once messages overflow. */}
        <div aria-hidden className="flex-1" />
        {props.loading ? (
          <ThreadSkeleton />
        ) : props.messages.length === 0 ? (
          <ThreadEmptyState
            title={props.emptyTitle ?? "Start the conversation"}
            body={props.emptyBody ?? "Send your office a message. They will see it right away."}
          />
        ) : (
          props.messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-3">
              {m.showDayDivider && (
                <div className="self-center text-[11px] font-semibold text-muted-foreground">
                  {m.dayLabel}
                </div>
              )}
              <MessageBubble message={m} onOpenBooking={props.onOpenBooking} />
            </div>
          ))
        )}
        <div ref={props.messagesEndRef} aria-hidden />
      </div>

      {props.readOnly ? (
        <div className="border-t border-border/60 bg-muted/40 px-4 py-3 text-center text-xs font-medium text-muted-foreground">
          {props.readOnlyNotice ?? 'This conversation is closed. You can still read the history.'}
        </div>
      ) : (
        <MessageComposer {...props.composer} />
      )}
    </div>
  );
}
