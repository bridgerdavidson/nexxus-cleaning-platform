// src/components/redesign/calendar/deriveCalendar.ts
/**
 * Maps the redesign's AdminAppointment rows into the shared CalendarEvent shape
 * (times pre-parsed to minutes, customer label resolved, duration defaulted),
 * mirroring the legacy toCalendarEvent but reading AdminAppointment. Pure so it
 * unit-tests without hooks; the container memoizes deriveCalendarEvents.
 */
import type { AdminAppointment } from '@/hooks/useAdminData';
import type { CalendarEvent } from '@/lib/calendar/types';
import { resolveCustomerLabel } from '@/lib/calendar/resolveDisplayName';

export function toCalendarEvent(a: AdminAppointment): CalendarEvent {
  const [y, m, d] = a.scheduled_date.split('-').map(Number);
  const [hh = 0, mm = 0] = (a.scheduled_time || '00:00').split(':').map(Number);
  const startMin = hh * 60 + mm;
  const durationMin = a.duration_minutes && a.duration_minutes > 0 ? a.duration_minutes : 60;

  const up = a.cleaner_profile?.user_profile;
  const cleanerName = up ? `${up.first_name ?? ''} ${up.last_name ?? ''}`.trim() || null : null;

  const serviceLabel = a.service_type?.name
    ? a.checklist?.name
      ? `${a.service_type.name} (${a.checklist.name})`
      : a.service_type.name
    : 'Service';

  const hasSuggestedTimes = (a.cleaner_availability_feedback ?? []).some(
    (f) => (f.cleaner_suggested_times?.length ?? 0) > 0,
  );

  return {
    id: a.id,
    date: a.scheduled_date,
    startMin,
    durationMin,
    endMin: startMin + durationMin,
    start: new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm),
    status: a.status,
    cleanerConfirmationStatus: a.cleaner_confirmation_status ?? null,
    hasSuggestedTimes,
    customerLabel: resolveCustomerLabel(a),
    serviceLabel,
    cleanerId: a.cleaner_id ?? null,
    cleanerName,
    paymentStatus: a.payment_status ?? null,
    seriesId: a.series_id ?? null,
    totalPrice: a.total_price,
    responseDeadline: a.response_deadline ?? null,
  };
}

export function deriveCalendarEvents(appts: AdminAppointment[]): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const a of appts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(toCalendarEvent(a));
  }
  return out;
}
