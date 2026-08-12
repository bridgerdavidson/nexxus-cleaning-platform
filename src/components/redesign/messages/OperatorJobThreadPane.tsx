'use client';

import { useMemo } from 'react';
import { useJobThreadMessages } from '@/hooks/useJobThreadMessages';
import { ThreadHeader } from './ThreadHeader';
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
      <ThreadHeader
        onBack={onBack}
        backHiddenOnDesktop
        backAriaLabel="Back to conversations"
        title={title}
        subtitle={`${dateLabel ? `${dateLabel} · ` : ''}Read only`}
      />
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
