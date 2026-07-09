'use client';

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { useSendMessage } from '@/hooks/useSendMessage';
import { useSendJobMessage } from '@/hooks/useSendJobMessage';
import { toast } from '@/components/ui/toast';
import { isMessagingForbiddenError, MESSAGING_FORBIDDEN_TEXT } from '@/lib/messagingPermissions';
import { toMessageVM } from '@/components/redesign/messages/messages-presenters';
import { MessageThreadTakeoverView } from '@/components/redesign/messages/MessageThreadTakeoverView';
import type { Appointment } from '@/hooks/useHomeownerData';
import type { OfficeContact } from '@/components/redesign/cleaner/messages/office-contacts';

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'O';
}

type ThreadConfig =
  | { kind: 'office'; recipient: OfficeContact }
  | { kind: 'job'; appointment: Appointment; cleanerName: string; avatarUrl: string | null; readOnly: boolean; readOnlyNotice?: string };

export function HomeownerMessageThread({
  config,
  conversationId,
  onBack,
}: {
  config: ThreadConfig;
  conversationId: string | null;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [activeConvId, setActiveConvId] = useState<string | null>(conversationId);
  useEffect(() => setActiveConvId(conversationId), [conversationId]);

  const {
    messages: rawMessages, loading, hasMore, isLoadingMore, loadMoreMessages, messagesEndRef,
  } = useMessages({ conversationId: activeConvId, userId });
  const { sendMessage, sending: sendingOffice } = useSendMessage();
  const { sendJobMessage, sending: sendingJob } = useSendJobMessage();

  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Job threads reference one appointment for every message; suppress inline booking cards.
  const messages = useMemo(
    () => rawMessages.map((m, i) => toMessageVM(m, userId, i > 0 ? rawMessages[i - 1] : null, () => null)),
    [rawMessages, userId],
  );

  // The homeowner messages "the office" as one entity, never a named individual,
  // so the office thread header reads "Cleaning office" with a generic icon (matching
  // the inbox row) even though the underlying conversation is with one staff member.
  const title = config.kind === 'office' ? 'Cleaning office' : config.cleanerName;
  const avatarUrl = config.kind === 'office' ? null : config.avatarUrl;
  const readOnly = config.kind === 'job' && config.readOnly;
  const readOnlyNotice =
    config.kind === 'job' && config.readOnlyNotice
      ? config.readOnlyNotice
      : 'This cleaning is finished. You can still read the conversation.';
  const sending = config.kind === 'office' ? sendingOffice : sendingJob;

  const onSend = useCallback(async () => {
    const content = draft.trim();
    if (config.kind === 'office') {
      if (!content && pendingFiles.length === 0) return;
      const res = await sendMessage({
        conversationId: activeConvId ?? undefined,
        senderId: userId,
        recipientId: config.recipient.id,
        content,
        attachments: pendingFiles,
      });
      if (res.success) {
        setDraft('');
        setPendingFiles([]);
        if (!activeConvId && res.conversationId) setActiveConvId(res.conversationId);
      } else {
        toast.error(isMessagingForbiddenError(res) ? MESSAGING_FORBIDDEN_TEXT : res.error || 'Could not send the message.');
      }
    } else {
      if (!content) return;
      const res = await sendJobMessage({ appointmentId: config.appointment.id, content });
      if (res.success) {
        setDraft('');
        if (!activeConvId && res.conversationId) setActiveConvId(res.conversationId);
      } else {
        toast.error(res.error || 'Could not send the message.');
      }
    }
  }, [draft, pendingFiles, config, sendMessage, sendJobMessage, activeConvId, userId]);

  return (
    <MessageThreadTakeoverView
      title={title}
      initials={initials(title)}
      avatarUrl={avatarUrl}
      conversationKey={activeConvId}
      messages={messages}
      loading={loading && !!activeConvId}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={loadMoreMessages}
      messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
      onOpenBooking={() => {}}
      variant="takeover"
      onBack={onBack}
      readOnly={readOnly}
      readOnlyNotice={readOnlyNotice}
      emptyTitle={config.kind === 'office' ? 'Message your office' : 'Message about this cleaning'}
      emptyBody={
        config.kind === 'office'
          ? 'Send your cleaning office a message. They will see it right away.'
          : 'Coordinate access and details with your cleaner. They will see it right away.'
      }
      composer={{
        draft,
        onDraftChange: setDraft,
        pendingFiles,
        onAddFiles: (f) => setPendingFiles((p) => [...p, ...f].slice(0, 5)),
        onRemoveFile: (i) => setPendingFiles((p) => p.filter((_, idx) => idx !== i)),
        stagedBooking: null,
        attachableBookings: [],
        onStageBooking: () => {},
        onClearStagedBooking: () => {},
        onSend,
        sending,
        isMobile: true,
        showReferenceBooking: false,
        showAddImage: config.kind === 'office',
      }}
    />
  );
}
