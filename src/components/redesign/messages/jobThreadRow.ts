import type { JobThreadSummary } from '@/hooks/useOrgJobThreads';

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

function monthDay(s?: string | null): string {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return monthDay(new Date(iso).toISOString().slice(0, 10));
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
    timeLabel: timeAgo(summary.lastMessageAt, now),
    unreadCount: summary.unreadCount,
  };
}
