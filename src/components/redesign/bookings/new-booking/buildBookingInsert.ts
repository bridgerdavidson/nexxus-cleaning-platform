import type { ServiceType } from '@/hooks/useServices';
import { effectiveTotalUsd, isSelfPay, cardIdFromPaymentValue } from './deriveOperatorBooking';
import type { OperatorBookingState } from './operator-booking-types';

export interface BookingInsert {
  appointment: {
    organization_id: string;
    homeowner_id: string | null;
    cleaner_id: string | null;
    property_id: string | null;
    service_type_id: string | null;
    checklist_id: string | null;
    scheduled_date: string;
    scheduled_time: string;
    duration_minutes: number;
    total_price: number;
    price_override_enabled: boolean;
    price_override_total: number | null;
    special_requests: string | null;
    payment_method_id: string | null;
    is_self_pay: boolean;
    status: 'pending';
    cleaner_confirmation_status: 'awaiting';
    response_deadline: string | null;
  };
  slots: { slot_index: number; scheduled_date: string; scheduled_time: string }[];
}

/**
 * Map the operator booking state to the exact `appointments` insert (+ offered slots), mirroring the
 * legacy AddAppointmentModal. `homeowner_id` is null only when self-pay with no customer (org-owned);
 * the DB CHECK requires `is_self_pay = true OR homeowner_id IS NOT NULL`. `payment_method_id` is a
 * concrete card id only (null for self-pay / send-link / defer). Pure so it unit-tests in isolation.
 */
export function buildBookingInsert(
  orgId: string,
  s: OperatorBookingState,
  service: ServiceType,
  responseDeadline: string | null,
): BookingInsert {
  const self = isSelfPay(s);
  const primary = s.slots[0];
  return {
    appointment: {
      organization_id: orgId,
      homeowner_id: s.customerId, // null allowed only in self-pay (org-owned); CHECK enforces otherwise
      cleaner_id: s.cleanerId,
      property_id: s.propertyId,
      service_type_id: s.serviceTypeId,
      checklist_id: s.checklistId,
      scheduled_date: primary.date,
      scheduled_time: primary.time,
      duration_minutes: service.duration_minutes,
      total_price: effectiveTotalUsd(s, service),
      price_override_enabled: s.priceOverride != null,
      price_override_total: s.priceOverride,
      special_requests: s.notes.trim() ? s.notes.trim() : null,
      payment_method_id: self ? null : cardIdFromPaymentValue(s.paymentValue),
      is_self_pay: self,
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: responseDeadline,
    },
    slots: s.slots.map((sl, i) => ({
      slot_index: i,
      scheduled_date: sl.date,
      scheduled_time: sl.time,
    })),
  };
}
