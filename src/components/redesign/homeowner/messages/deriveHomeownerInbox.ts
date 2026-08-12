import type { ConversationWithDetails } from '@/types';
import type { Appointment } from '@/hooks/useHomeownerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { toConversationRowVM } from '@/components/redesign/messages/messages-presenters';
import { weekdayMonthDay } from '@/components/redesign/messages/messages-format';
import type { HomeownerInboxModel, JobThreadRowVM } from './homeowner-messages-types';

interface DeriveInput {
  officeRows: ConversationWithDetails[];
  jobRows: ConversationWithDetails[];
  appointmentsById: Map<string, Appointment>;
  now: Date;
  currentUserId: string;
}

function cleanerName(a: Appointment): string {
  const u = a.cleaner_profile?.user_profile;
  const n = `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();
  return n || 'Your cleaner';
}

/**
 * Sections the homeowner inbox: every office thread (a homeowner can hold more
 * than one, e.g. one with the owner/admin and one with a manager), active job
 * threads (send window open), and past job threads (archived, read-only).
 * Job rows whose appointment is not in the loaded set are dropped (defensive).
 */
export function deriveHomeownerInbox(input: DeriveInput): HomeownerInboxModel {
  const { officeRows, jobRows, appointmentsById, now, currentUserId } = input;

  const office = [...officeRows]
    .sort(
      (a, b) =>
        new Date(b.last_message_at ?? b.created_at).getTime() -
        new Date(a.last_message_at ?? a.created_at).getTime(),
    )
    .map((row) => toConversationRowVM(row, currentUserId));

  const active: JobThreadRowVM[] = [];
  const past: JobThreadRowVM[] = [];

  for (const conv of jobRows) {
    if (!conv.appointment_id) continue;
    const appt = appointmentsById.get(conv.appointment_id);
    if (!appt) continue;
    const base = toConversationRowVM(conv, currentUserId);
    const row: JobThreadRowVM = {
      conversationId: conv.id,
      appointmentId: conv.appointment_id,
      cleanerName: cleanerName(appt),
      dateLabel: weekdayMonthDay(appt.scheduled_date),
      status: appt.status,
      preview: base.preview,
      timeLabel: base.timeLabel,
      unreadCount: base.unreadCount,
      avatarUrl: appt.cleaner_profile?.user_profile?.avatar_url ?? null,
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

  const byRecent = (a: JobThreadRowVM, b: JobThreadRowVM) => {
    const ca = jobRows.find((c) => c.id === a.conversationId);
    const cb = jobRows.find((c) => c.id === b.conversationId);
    return (
      new Date(cb?.last_message_at ?? cb?.created_at ?? 0).getTime() -
      new Date(ca?.last_message_at ?? ca?.created_at ?? 0).getTime()
    );
  };
  active.sort(byRecent);
  past.sort(byRecent);

  return { office, active, past };
}
