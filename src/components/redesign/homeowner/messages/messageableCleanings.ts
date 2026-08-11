import type { Appointment } from '@/hooks/useHomeownerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { weekdayMonthDay } from '@/components/redesign/messages/messages-format';

export interface MessageableCleaning {
  appointmentId: string;
  cleanerName: string;
  dateLabel: string;
  serviceLabel: string;
}

function getCleanerName(a: Appointment): string {
  const u = a.cleaner_profile?.user_profile;
  const n = `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();
  return n || 'Your cleaner';
}

/**
 * Appointments the homeowner can start/continue a cleaner thread on right now
 * (a cleaner is assigned AND the job-messaging window is open), soonest first.
 */
export function messageableCleanings(appointments: Appointment[], now: Date): MessageableCleaning[] {
  return appointments
    .filter((a) => !!a.cleaner_id)
    .filter((a) =>
      isJobMessagingWindowOpen(
        {
          status: a.status,
          cleaner_confirmation_status: a.cleaner_confirmation_status ?? null,
          completed_at: a.completed_at ?? null,
          cancelled_at: a.cancelled_at ?? null,
        },
        now,
      ),
    )
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .map((a) => ({
      appointmentId: a.id,
      cleanerName: getCleanerName(a),
      dateLabel: weekdayMonthDay(a.scheduled_date),
      serviceLabel: a.service_type?.name ?? 'Cleaning',
    }));
}
