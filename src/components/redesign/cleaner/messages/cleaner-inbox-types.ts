import type { ConversationRowVM } from '@/components/redesign/messages/messages-types';
import type { CleanerAppointment } from '@/hooks/useCleanerData';

/** A per-cleaning job thread row on the cleaner side (counterparty = the homeowner). */
export interface CleanerJobRowVM {
  conversationId: string;
  appointmentId: string;
  /** The homeowner's name (or "Homeowner" fallback). */
  homeownerName: string;
  /** "Tue, Jun 30" cleaning date. */
  dateLabel: string;
  status: CleanerAppointment['status'];
  preview: string;
  timeLabel: string;
  unreadCount: number;
}

export interface CleanerInboxModel {
  /** Office thread rows (most-recent first); the org's admins/managers the cleaner has messaged. */
  office: ConversationRowVM[];
  active: CleanerJobRowVM[];
  past: CleanerJobRowVM[];
}
