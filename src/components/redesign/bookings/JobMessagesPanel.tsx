'use client';

import { useMemo } from 'react';
import { useJobThreadMessages } from '@/hooks/useJobThreadMessages';
import { toJobTranscriptVM } from '@/components/redesign/messages/jobTranscript';
import { JobThreadTranscript } from '@/components/redesign/messages/JobThreadTranscript';

/**
 * Read-only "Messages on this job" panel for the operator booking detail. Shows
 * the homeowner<->cleaner per-appointment thread (view-only). Only render this
 * when the appointment has both a homeowner and an assigned cleaner (a job thread
 * needs both participants).
 */
export function JobMessagesPanel({
  appointmentId,
  cleanerId,
}: {
  appointmentId: string;
  cleanerId: string;
}) {
  const { messages, loading, hasMore, isLoadingMore, loadMoreMessages } = useJobThreadMessages({
    appointmentId,
  });

  const rows = useMemo(() => toJobTranscriptVM(messages, { cleanerId }), [messages, cleanerId]);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        Messages on this job
      </div>
      <p className="text-xs text-muted-foreground">
        The conversation between the homeowner and the cleaner. View only.
      </p>
      <JobThreadTranscript
        rows={rows}
        loading={loading}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMoreMessages}
        conversationKey={appointmentId}
      />
    </div>
  );
}
