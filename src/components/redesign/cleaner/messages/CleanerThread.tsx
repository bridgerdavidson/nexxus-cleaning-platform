"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMessages } from "@/hooks/useMessages";
import { useSendMessage } from "@/hooks/useSendMessage";
import { useCleanerAppointments, type CleanerAppointment } from "@/hooks/useCleanerData";
import { toast } from "@/components/ui/toast";
import { isMessagingForbiddenError, MESSAGING_FORBIDDEN_TEXT } from "@/lib/messagingPermissions";
import { toMessageVM } from "@/components/redesign/messages/messages-presenters";
import { useOpenJob } from "../job/useOpenJob";
import { cleanerApptToContactBookingVM, cleanerApptToInlineBookingVM } from "./messages-cleaner-presenters";
import { CleanerMessageThreadView } from "./CleanerMessageThreadView";
import type { OfficeContact } from "./office-contacts";

function initialsFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join("").toUpperCase() || "O";
}

export function CleanerThread({
  conversationId,
  recipient,
  variant,
  onBack,
  armedAppointment,
  onArmedConsumed,
}: {
  conversationId: string | null;
  recipient: OfficeContact;
  variant: "inline" | "takeover";
  onBack?: () => void;
  armedAppointment?: CleanerAppointment | null;
  onArmedConsumed?: () => void;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  // A fresh single-office thread has no conversation yet; capture the one the first
  // send creates so useMessages re-subscribes and shows the conversation.
  const [activeConvId, setActiveConvId] = useState<string | null>(conversationId);
  useEffect(() => setActiveConvId(conversationId), [conversationId]);

  const {
    messages: rawMessages,
    loading,
    hasMore,
    isLoadingMore,
    loadMoreMessages,
    messagesEndRef,
  } = useMessages({ conversationId: activeConvId, userId });
  const { sendMessage, sending } = useSendMessage();
  const { appointments } = useCleanerAppointments();
  const openJob = useOpenJob();

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const apptById = useMemo(() => {
    const m = new Map<string, CleanerAppointment>();
    for (const a of appointments) m.set(a.id, a);
    return m;
  }, [appointments]);

  const messages = useMemo(
    () =>
      rawMessages.map((msg, i) =>
        toMessageVM(msg, userId, i > 0 ? rawMessages[i - 1] : null, (apptId) =>
          cleanerApptToInlineBookingVM(apptById.get(apptId), apptId),
        ),
      ),
    [rawMessages, userId, apptById],
  );

  const stagedBooking = useMemo(
    () => (armedAppointment ? cleanerApptToContactBookingVM(armedAppointment) : null),
    [armedAppointment],
  );

  const onSend = useCallback(async () => {
    const content = draft.trim();
    if (!content && pendingFiles.length === 0 && !armedAppointment) return;
    const res = await sendMessage({
      conversationId: activeConvId ?? undefined,
      senderId: userId,
      recipientId: recipient.id,
      content,
      attachments: pendingFiles,
      appointmentId: armedAppointment?.id,
    });
    if (res.success) {
      setDraft("");
      setPendingFiles([]);
      onArmedConsumed?.();
      if (!activeConvId && res.conversationId) setActiveConvId(res.conversationId);
    } else {
      toast.error(
        isMessagingForbiddenError(res) ? MESSAGING_FORBIDDEN_TEXT : res.error || "Could not send the message.",
      );
    }
  }, [draft, pendingFiles, armedAppointment, sendMessage, activeConvId, userId, recipient.id, onArmedConsumed]);

  return (
    <CleanerMessageThreadView
      title={variant === "inline" ? "Office" : recipient.name}
      initials={initialsFromName(recipient.name)}
      avatarUrl={recipient.avatarUrl}
      conversationKey={activeConvId}
      messages={messages}
      loading={loading && !!activeConvId}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={loadMoreMessages}
      messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
      onOpenBooking={openJob}
      composer={{
        draft,
        onDraftChange: setDraft,
        pendingFiles,
        onAddFiles: (f) => setPendingFiles((p) => [...p, ...f].slice(0, 5)),
        onRemoveFile: (i) => setPendingFiles((p) => p.filter((_, idx) => idx !== i)),
        stagedBooking,
        attachableBookings: [],
        onStageBooking: () => {},
        onClearStagedBooking: () => onArmedConsumed?.(),
        onSend,
        sending,
        isMobile: true,
        showReferenceBooking: false,
      }}
      variant={variant}
      onBack={onBack}
    />
  );
}
