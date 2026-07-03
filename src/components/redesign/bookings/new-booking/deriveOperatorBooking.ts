import type { ServiceType } from '@/hooks/useServices';
import {
  MAX_OPERATOR_SLOTS,
  type OperatorBookingSlot,
  type OperatorBookingState,
} from './operator-booking-types';

export function isSelfPay(s: OperatorBookingState): boolean {
  return s.billTo === 'self_pay';
}

export function addSlot(slots: OperatorBookingSlot[], slot: OperatorBookingSlot): OperatorBookingSlot[] {
  return slots.length >= MAX_OPERATOR_SLOTS ? slots : [...slots, slot];
}

export function removeSlotAt(slots: OperatorBookingSlot[], idx: number): OperatorBookingSlot[] {
  return slots.filter((_, i) => i !== idx);
}

/** The price charged: an operator override if set, else the service base price (dollars). */
export function effectiveTotalUsd(s: OperatorBookingState, service: ServiceType | null): number {
  if (s.priceOverride != null) return s.priceOverride;
  return service?.base_price ?? 0;
}

export function canReview(s: OperatorBookingState): boolean {
  const hasCustomer = isSelfPay(s) ? true : !!s.customerId;
  return (
    hasCustomer &&
    !!s.propertyId &&
    !!s.serviceTypeId &&
    !!s.checklistId &&
    s.slots.length >= 1 &&
    !!s.cleanerId
  );
}

export function canCreate(s: OperatorBookingState): boolean {
  if (!canReview(s)) return false;
  // Self-pay needs an org method on file; customer-billed can defer (card/link/collect later).
  return isSelfPay(s) ? s.selfPayHasMethod : true;
}

/** The concrete saved-card id to charge, or null for a send-link / defer / no selection. */
export function cardIdFromPaymentValue(v: string | null): string | null {
  return v && v.startsWith('pm_') ? v : null;
}

/**
 * Whether the booking can be created, recurrence-aware. A recurring (customer-billed) series also
 * requires the current cadence + end to produce at least one occurrence.
 */
export function canCreateBooking(s: OperatorBookingState, occurrenceCount: number): boolean {
  if (!canCreate(s)) return false;
  if (isSelfPay(s)) return true;
  if (!s.recurrence.enabled) return true;
  return occurrenceCount >= 1;
}
