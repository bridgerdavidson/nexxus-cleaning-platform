import type { Appointment } from '@/hooks/useHomeownerData';
import { formatTimeTo12h } from '@/lib/formatTime';

export type HeroState = 'empty' | 'upcoming' | 'in_progress' | 'complete';
export type HomeownerStatusTone = 'default' | 'secondary' | 'positive' | 'caution' | 'critical';

/** The single cleaning the Home hero should feature. */
export function pickHeroAppointment(
  appointments: Appointment[],
  todayStr: string,
): Appointment | null {
  const inProgress = appointments.find((a) => a.status === 'in_progress');
  if (inProgress) return inProgress;

  const upcoming = appointments
    .filter(
      (a) =>
        a.scheduled_date >= todayStr &&
        (a.status === 'pending' || a.status === 'confirmed'),
    )
    .sort(
      (a, b) =>
        a.scheduled_date.localeCompare(b.scheduled_date) ||
        a.scheduled_time.localeCompare(b.scheduled_time),
    );
  if (upcoming.length > 0) return upcoming[0];

  const completed = appointments
    .filter((a) => a.status === 'completed')
    .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
  return completed[0] ?? null;
}

export function deriveHeroState(appt: Appointment | null): HeroState {
  if (!appt) return 'empty';
  if (appt.status === 'in_progress') return 'in_progress';
  if (appt.status === 'completed') return 'complete';
  return 'upcoming';
}

export function homeownerStatusLabel(
  status: Appointment['status'],
): { label: string; tone: HomeownerStatusTone } {
  switch (status) {
    case 'pending':
      return { label: 'Requested', tone: 'caution' };
    case 'confirmed':
      return { label: 'Confirmed', tone: 'secondary' };
    case 'in_progress':
      return { label: 'In progress', tone: 'default' };
    case 'completed':
      return { label: 'All done', tone: 'positive' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'critical' };
    default:
      return { label: 'Scheduled', tone: 'secondary' };
  }
}

export function cleanerDisplayName(appt: Appointment): string | null {
  const p = appt.cleaner_profile?.user_profile;
  const first = p?.first_name?.trim();
  if (!first) return null;
  const last = p?.last_name?.trim();
  return last ? `${first} ${last.charAt(0)}.` : first;
}

/** True when a cleaning still carries what a repeat booking needs to prefill:
 *  both its property and its service. Guards the Home "Book this again" action so
 *  it never opens the flow with a missing (deleted home / removed service) id. */
export function canBookAgain(appt: Appointment): boolean {
  return Boolean(appt.property_id && appt.service_type_id);
}

/** Footer task summary for the recent-cleaning card ("All 9 tasks done" / "6 of 9
 *  tasks done"), or null when the cleaning has no checklist. */
export function recentCleaningTaskLabel(doneCount: number, totalCount: number): string | null {
  if (totalCount <= 0) return null;
  if (doneCount >= totalCount) return `All ${totalCount} tasks done`;
  return `${doneCount} of ${totalCount} tasks done`;
}

/** Payment-status pill for the recent-cleaning card. Defaults to "Payment due" for any
 *  not-yet-settled state so the homeowner always sees an unambiguous money signal. */
export function recentCleaningPaymentBadge(
  status: string | null | undefined,
): { label: string; tone: HomeownerStatusTone } {
  switch (status) {
    case 'paid':
      return { label: 'Paid', tone: 'positive' };
    case 'refunded':
      return { label: 'Refunded', tone: 'secondary' };
    case 'processing':
      return { label: 'Processing', tone: 'default' };
    case 'failed':
      return { label: 'Payment failed', tone: 'critical' };
    default:
      return { label: 'Payment due', tone: 'caution' };
  }
}

export function formatCleaningWhen(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const datePart = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${datePart} · ${formatTimeTo12h(timeStr)}`;
}
