'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { LoadMoreSpinner, ThreadEmptyState, ThreadSkeleton } from './ThreadStates';
import type { JobTranscriptRowVM } from './jobTranscript';

/**
 * Read-only transcript of a homeowner<->cleaner job thread for an operator. The
 * operator is neither party, so messages are labeled by sender and aligned by
 * participant (cleaner right, homeowner left) instead of the mine/theirs bubble
 * used in 2-party chat. No composer: the office never posts into a job thread.
 */
export function JobThreadTranscript({
  rows,
  loading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  conversationKey = null,
  emptyText = 'No messages between the homeowner and cleaner yet.',
  maxHeightClassName = 'max-h-80',
}: {
  rows: JobTranscriptRowVM[];
  loading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Changes when the underlying thread changes, to reset the initial scroll. */
  conversationKey?: string | null;
  emptyText?: string;
  /** Scroll-area height cap. Default 'max-h-80' (booking panel); the console pane passes 'max-h-full'. */
  maxHeightClassName?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  // Reset the initial-scroll flag whenever the thread changes.
  useEffect(() => {
    didInitialScrollRef.current = false;
  }, [conversationKey]);

  // Initial load: jump to the latest message (bottom). This shows the most
  // recent message first AND pushes the top load-more sentinel off-screen, so
  // the IntersectionObserver below does not immediately auto-page the whole
  // history while the view is pinned at the top.
  useEffect(() => {
    if (loading || rows.length === 0 || didInitialScrollRef.current) return;
    const sc = scrollRef.current;
    if (!sc) return;
    didInitialScrollRef.current = true;
    sc.scrollTop = sc.scrollHeight;
  }, [loading, rows]);

  // Paging: observe the top sentinel, but only fire once the initial
  // scroll-to-bottom has happened (so a recreated observer can never auto-page
  // on first paint). Older pages prepend above the current view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      entries => {
        if (
          entries[0]?.isIntersecting &&
          hasMore &&
          !isLoadingMore &&
          didInitialScrollRef.current
        ) {
          onLoadMore();
        }
      },
      { root: scrollRef.current, rootMargin: '120px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (loading) {
    return <ThreadSkeleton className="py-2" />;
  }

  if (rows.length === 0) {
    return <ThreadEmptyState title="No messages yet" body={emptyText} />;
  }

  return (
    <div ref={scrollRef} className={cn('space-y-2 overflow-y-auto pr-1', maxHeightClassName)}>
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {isLoadingMore && <LoadMoreSpinner />}
      {rows.map(row => (
        <div key={row.id} className="flex flex-col gap-1">
          {row.showDayDivider && (
            <div className="self-center py-1 text-[11px] font-semibold text-muted-foreground">
              {row.dayLabel}
            </div>
          )}
          <div className={cn('flex flex-col', row.side === 'cleaner' ? 'items-end' : 'items-start')}>
            <div className="px-1 text-[11px] font-semibold text-muted-foreground">
              {row.senderName}
              <span className="ml-1.5 font-normal">{row.timeLabel}</span>
            </div>
            {/* MessageBubble's geometry (D7): rounded-card + bottom tail, px-3.5 py-2,
                max-w-[78%], quiet border. Tint-by-participant stays: this is an
                observer view of two OTHER people, not a mine/theirs chat. */}
            <div
              className={cn(
                'mt-0.5 max-w-[78%] whitespace-pre-wrap break-words rounded-card border border-border/60 px-3.5 py-2 text-sm text-foreground',
                row.side === 'cleaner' ? 'rounded-br-sm bg-primary/10' : 'rounded-bl-sm bg-muted',
              )}
            >
              {row.content}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
