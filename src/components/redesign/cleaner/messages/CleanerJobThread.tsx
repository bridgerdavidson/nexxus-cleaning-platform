'use client';

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { useSendJobMessage } from '@/hooks/useSendJobMessage';
import { toast } from '@/components/ui/toast';
import { toMessageVM } from '@/components/redesign/messages/messages-presenters';
import { MessageThreadTakeoverView } from '@/components/redesign/messages/MessageThreadTakeoverView';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'H';
}

/**
 * Cleaner side of a homeowner<->cleaner per-appointment job thread. The cleaner is
 * a participant; reads via useMessages, sends via the guarded route
 * (useSendJobMessage), window-gated read-only. Mirrors HomeownerMessageThread's
 * job branch, counterparty = the homeowner.
 */
export function CleanerJobThread({
  appointmentId,
  conversationId,
  homeownerName,
  avatarUrl,
  readOnly,
  readOnlyNotice,
  onBack,
  backLabel,
}: {
  appointmentId: string;
  conversationId: string | null;
  homeownerName: string;
  avatarUrl: string | null;
  readOnly: boolean;
  /** Overrides the default read-only notice (e.g. when the org kill-switch is off). */
  readOnlyNotice?: string;
  onBack: () => void;
  backLabel?: string;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [activeConvId, setActiveConvId] = useState<string | null>(conversationId);
  useEffect(() => setActiveConvId(conversationId), [conversationId]);

  const { messages: rawMessages, loading, hasMore, isLoadingMore, loadMoreMessages, messagesEndRef } =
    useMessages({ conversationId: activeConvId, userId });
  const { sendJobMessage, sending } = useSendJobMessage();
  const [draft, setDraft] = useState('');

  // Every message in a job thread references the one appointment; suppress inline booking cards.
  const messages = useMemo(
    () => rawMessages.map((m, i) => toMessageVM(m, userId, i > 0 ? rawMessages[i - 1] : null, () => null)),
    [rawMessages, userId],
  );

  const onSend = useCallback(async () => {
    const content = draft.trim();
    if (!content) return;
    const res = await sendJobMessage({ appointmentId, content });
    if (res.success) {
      setDraft('');
      if (!activeConvId && res.conversationId) setActiveConvId(res.conversationId);
    } else {
      toast.error(res.error || 'Could not send the message.');
    }
  }, [draft, sendJobMessage, appointmentId, activeConvId]);

  return (
    <MessageThreadTakeoverView
      title={homeownerName}
      initials={initials(homeownerName)}
      avatarUrl={avatarUrl}
      conversationKey={activeConvId}
      messages={messages}
      loading={loading && !!activeConvId}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={loadMoreMessages}
      messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
      onOpenBooking={() => {}}
      onBack={onBack}
      backLabel={backLabel}
      readOnly={readOnly}
      readOnlyNotice={readOnlyNotice ?? 'This cleaning is finished. You can still read the conversation.'}
      emptyTitle="Message the homeowner"
      emptyBody="Coordinate access and details with the homeowner. They will see it right away."
      composer={{
        draft,
        onDraftChange: setDraft,
        pendingFiles: [],
        onAddFiles: () => {},
        onRemoveFile: () => {},
        stagedBooking: null,
        attachableBookings: [],
        onStageBooking: () => {},
        onClearStagedBooking: () => {},
        onSend,
        sending,
        isMobile: true,
        showReferenceBooking: false,
        showAddImage: false,
      }}
    />
  );
}
