'use client';

import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { useJobThreadMessages } from '@/hooks/useJobThreadMessages';
import { toJobTranscriptVM } from './jobTranscript';
import { JobThreadTranscript } from './JobThreadTranscript';

/**
 * Read-only pane for a single homeowner<->cleaner job thread in the operator
 * console. Reuses the 2a read-only primitives (useJobThreadMessages +
 * toJobTranscriptVM + JobThreadTranscript). No composer: the office never posts
 * into a job thread.
 */
export function OperatorJobThreadPane({
  appointmentId,
  title,
  dateLabel,
  cleanerId,
  onBack,
}: {
  appointmentId: string;
  title: string;
  dateLabel: string;
  cleanerId: string | null;
  onBack?: () => void;
}) {
  const { messages, loading, hasMore, isLoadingMore, loadMoreMessages } = useJobThreadMessages({
    appointmentId,
  });
  const rows = useMemo(() => toJobTranscriptVM(messages, { cleanerId }), [messages, cleanerId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border/60 bg-card px-3 py-2.5">
        {onBack && (
          <IconButton
            aria-label="Back to conversations"
            className="h-9 w-9 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-5" />
          </IconButton>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">
            {dateLabel ? `${dateLabel} · ` : ''}Read only
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-5 py-4">
        <JobThreadTranscript
          rows={rows}
          loading={loading}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreMessages}
          conversationKey={appointmentId}
          maxHeightClassName="max-h-full"
        />
      </div>
    </div>
  );
}
