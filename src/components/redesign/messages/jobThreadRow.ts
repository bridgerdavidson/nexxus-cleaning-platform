import type { JobThreadSummary } from '@/hooks/useOrgJobThreads';
import { monthDay, timeAgo } from './messages-format';

export interface JobThreadRowVM {
  appointmentId: string;
  cleanerId: string | null;
  title: string;
  dateLabel: string;
  preview: string;
  timeLabel: string;
  unreadCount: number;
}

interface ApptLike {
  id: string;
  cleaner_id?: string | null;
  scheduled_date?: string | null;
  homeowner?: { first_name?: string | null; last_name?: string | null } | null;
  cleaner_profile?: {
    user_profile?: { first_name?: string | null; last_name?: string | null } | null;
  } | null;
}

function fullName(p?: { first_name?: string | null; last_name?: string | null } | null): string {
  return `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
}

/**
 * Build a read-only job-thread row for the operator console from a message-derived
 * summary + the appointment the operator already loads. Falls back to generic
 * labels when the appointment is not in the loaded set.
 */
export function toJobThreadRowVM(
  summary: JobThreadSummary,
  appointment: ApptLike | undefined,
  now: Date = new Date(),
): JobThreadRowVM {
  const home = fullName(appointment?.homeowner) || 'Homeowner';
  const cleaner = fullName(appointment?.cleaner_profile?.user_profile) || 'cleaner';
  const title = appointment ? `${home} and ${cleaner}` : 'Homeowner and cleaner';
  return {
    appointmentId: summary.appointmentId,
    cleanerId: appointment?.cleaner_id ?? null,
    title,
    dateLabel: monthDay(appointment?.scheduled_date),
    preview: summary.lastMessageContent || 'Photo',
    timeLabel: timeAgo(summary.lastMessageAt, now.toISOString()),
    unreadCount: summary.unreadCount,
  };
}
