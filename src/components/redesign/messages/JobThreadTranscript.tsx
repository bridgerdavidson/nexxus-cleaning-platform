'use client';

import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
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
  emptyText = 'No messages between the homeowner and cleaner yet.',
}: {
  rows: JobTranscriptRowVM[];
  loading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  emptyText?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) onLoadMore();
      },
      { root: scrollRef.current, rootMargin: '120px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className={cn('h-9 rounded-card', i % 2 ? 'ml-auto w-2/3' : 'w-1/2')} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <MessageSquare className="size-5 text-muted-foreground" aria-hidden />
        <p className="max-w-xs text-xs text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-80 space-y-2 overflow-y-auto pr-1">
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {isLoadingMore && (
        <div className="flex justify-center py-1">
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      )}
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
            <div
              className={cn(
                'mt-0.5 max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-sm',
                row.side === 'cleaner' ? 'bg-primary/10 text-foreground' : 'bg-muted text-foreground',
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
