import type { ConversationWithDetails } from '@/types';
import type { CleanerAppointment } from '@/hooks/useCleanerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { toConversationRowVM } from '@/components/redesign/messages/messages-presenters';
import type { CleanerInboxModel, CleanerJobRowVM } from './cleaner-inbox-types';

interface DeriveInput {
  officeRows: ConversationWithDetails[];
  jobRows: ConversationWithDetails[];
  appointmentsById: Map<string, CleanerAppointment>;
  now: Date;
  currentUserId: string;
}

function homeownerName(a: CleanerAppointment): string {
  const n = `${a.homeowner?.first_name ?? ''} ${a.homeowner?.last_name ?? ''}`.trim();
  return n || 'Homeowner';
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Sections the cleaner inbox: office threads (admins/managers the cleaner has
 * messaged), active job threads (send window open), and past job threads
 * (closed, read-only). Job rows whose appointment is not loaded are dropped.
 * The counterparty on a job thread is the HOMEOWNER (mirror of deriveHomeownerInbox).
 */
export function deriveCleanerInbox(input: DeriveInput): CleanerInboxModel {
  const { officeRows, jobRows, appointmentsById, now, currentUserId } = input;

  const recent = (a: ConversationWithDetails, b: ConversationWithDetails) =>
    new Date(b.last_message_at ?? b.created_at).getTime() -
    new Date(a.last_message_at ?? a.created_at).getTime();

  const office = [...officeRows].sort(recent).map((row) => toConversationRowVM(row, currentUserId));

  const active: CleanerJobRowVM[] = [];
  const past: CleanerJobRowVM[] = [];

  for (const conv of [...jobRows].sort(recent)) {
    if (!conv.appointment_id) continue;
    const appt = appointmentsById.get(conv.appointment_id);
    if (!appt) continue;
    const base = toConversationRowVM(conv, currentUserId);
    const row: CleanerJobRowVM = {
      conversationId: conv.id,
      appointmentId: conv.appointment_id,
      homeownerName: homeownerName(appt),
      dateLabel: dateLabel(appt.scheduled_date),
      status: appt.status,
      preview: base.preview,
      timeLabel: base.timeLabel,
      unreadCount: base.unreadCount,
    };
    (isJobMessagingWindowOpen(
      {
        status: appt.status,
        cleaner_confirmation_status: appt.cleaner_confirmation_status ?? null,
        completed_at: appt.completed_at ?? null,
        cancelled_at: appt.cancelled_at ?? null,
      },
      now,
    )
      ? active
      : past
    ).push(row);
  }

  return { office, active, past };
}
