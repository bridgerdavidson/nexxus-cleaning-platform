import type { ServiceType } from '@/hooks/useServices';
import type { OperatorBookingState } from './operator-booking-types';
import { effectiveTotalUsd, cardIdFromPaymentValue } from './deriveOperatorBooking';
import { resolveCadence, resolveEnd } from './deriveRecurrence';

/** Mirrors the POST /api/recurring-appointments request body (route.ts:19-40). */
export interface CreateRecurringPayload {
  organizationId: string;
  homeownerId: string;
  cleanerId: string | null;
  propertyId: string;
  serviceTypeId: string;
  checklistId: string | null;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  totalPrice: number;
  priceOverrideEnabled: boolean;
  priceOverrideTotal: number | null;
  recurrenceType: 'daily' | 'weekly' | 'monthly';
  interval: number;
  daysOfWeek?: number[];
  endDate: string | null;
  maxOccurrences: number | null;
  specialRequests: string | null;
  status: string;
  paymentMethodId: string | null;
}

/**
 * Build the recurring-series payload from operator booking state. Customer-billed only (the route
 * requires homeownerId); callers gate on isRecurring(). Mirrors the legacy AddAppointmentModal POST:
 * daysOfWeek only for weekly; endDate only for on-date; maxOccurrences only for after-N; pending status.
 */
export function buildRecurringPayload(
  organizationId: string,
  s: OperatorBookingState,
  service: ServiceType,
): CreateRecurringPayload {
  const primary = s.slots[0];
  const { recurrenceType, interval, daysOfWeek } = resolveCadence(s.recurrence, primary.date);
  const { endDate, maxOccurrences } = resolveEnd(s.recurrence);
  return {
    organizationId,
    homeownerId: s.customerId as string,
    cleanerId: s.cleanerId,
    propertyId: s.propertyId as string,
    serviceTypeId: s.serviceTypeId as string,
    checklistId: s.checklistId,
    startDate: primary.date,
    startTime: primary.time,
    durationMinutes: service.duration_minutes,
    totalPrice: effectiveTotalUsd(s, service),
    priceOverrideEnabled: s.priceOverride != null,
    priceOverrideTotal: s.priceOverride,
    recurrenceType,
    interval,
    daysOfWeek: recurrenceType === 'weekly' ? daysOfWeek : undefined,
    endDate,
    maxOccurrences,
    specialRequests: s.notes.trim() ? s.notes.trim() : null,
    status: 'pending',
    paymentMethodId: cardIdFromPaymentValue(s.paymentValue),
  };
}
