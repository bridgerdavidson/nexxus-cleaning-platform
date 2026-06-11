/**
 * Maps the calendar's `AppointmentCardData[]` input into normalized `CalendarEvent[]` (times
 * pre-parsed to minutes, customer label resolved, duration defaulted). Pure mapper exported
 * separately so it can be unit-tested; the hook just memoizes it.
 */
import { useMemo } from 'react';
import type { AppointmentCardData } from '@/components/AppointmentCard';
import type { CalendarEvent } from '@/lib/calendar/types';
import { resolveCustomerLabel } from '@/lib/calendar/resolveDisplayName';

export function toCalendarEvent(apt: AppointmentCardData, role?: string): CalendarEvent {
  const [y, m, d] = apt.scheduled_date.split('-').map(Number);
  const [hh = 0, mm = 0] = (apt.scheduled_time || '00:00').split(':').map(Number);
  const startMin = hh * 60 + mm;
  const durationMin = apt.duration_minutes && apt.duration_minutes > 0 ? apt.duration_minutes : 60;

  const up = apt.cleaner_profile?.user_profile;
  const cleanerName = up ? `${up.first_name ?? ''} ${up.last_name ?? ''}`.trim() || null : null;

  const serviceLabel = apt.service_type?.name
    ? apt.checklist?.name
      ? `${apt.service_type.name} (${apt.checklist.name})`
      : apt.service_type.name
    : 'Service';

  const hasSuggestedTimes = (apt.cleaner_availability_feedback ?? []).some(
    (f) => (f.cleaner_suggested_times?.length ?? 0) > 0,
  );

  return {
    id: apt.id,
    date: apt.scheduled_date,
    startMin,
    durationMin,
    endMin: startMin + durationMin,
    start: new Date(y, (m ?? 1) - 1, d ?? 1, hh, mm),
    status: apt.status,
    cleanerConfirmationStatus: apt.cleaner_confirmation_status ?? null,
    hasSuggestedTimes,
    customerLabel: resolveCustomerLabel(apt, role),
    serviceLabel,
    cleanerId: apt.cleaner_id ?? null,
    cleanerName,
    paymentStatus: apt.payment_status ?? null,
    authorizationStatus: apt.authorization_status ?? null,
    seriesId: apt.series_id ?? null,
    totalPrice: apt.total_price,
  };
}

export function useCalendarEvents(
  appointments: AppointmentCardData[],
  role?: string,
): CalendarEvent[] {
  // The calendar's input can contain the same appointment more than once (BookingsPage
  // concatenates overlapping active/today/upcoming/past lists). Dedupe by id so an event
  // renders once (unique React keys) and overlap lanes reflect reality.
  return useMemo(() => {
    const seen = new Set<string>();
    const out: CalendarEvent[] = [];
    for (const apt of appointments) {
      if (seen.has(apt.id)) continue;
      seen.add(apt.id);
      out.push(toCalendarEvent(apt, role));
    }
    return out;
  }, [appointments, role]);
}
