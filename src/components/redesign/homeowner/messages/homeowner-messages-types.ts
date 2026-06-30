import type { ConversationRowVM } from '@/components/redesign/messages/messages-types';

/** A per-cleaning job thread row (active or past). */
export interface JobThreadRowVM {
  conversationId: string;
  appointmentId: string;
  cleanerName: string;
  /** "Tue, Jun 30" cleaning date for labeling. */
  dateLabel: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  preview: string;
  timeLabel: string;
  unreadCount: number;
  avatarUrl: string | null;
}

export interface HomeownerInboxModel {
  /** The office thread row, or null when the homeowner has not messaged the office yet. */
  office: ConversationRowVM | null;
  active: JobThreadRowVM[];
  past: JobThreadRowVM[];
}
