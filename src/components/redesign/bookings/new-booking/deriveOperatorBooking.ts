import type { ServiceType } from '@/hooks/useServices';
import { jobPriceError } from '@/lib/pricing/minJobPrice';
import {
  MAX_OPERATOR_SLOTS,
  type OperatorBookingSlot,
  type OperatorBookingState,
} from './operator-booking-types';

export { selfPayCleanerBlockReason } from '@/lib/payments/isCleanerPayable';

export function isSelfPay(s: OperatorBookingState): boolean {
  return s.billTo === 'self_pay';
}

export function addSlot(slots: OperatorBookingSlot[], slot: OperatorBookingSlot): OperatorBookingSlot[] {
  return slots.length >= MAX_OPERATOR_SLOTS ? slots : [...slots, slot];
}

export function removeSlotAt(slots: OperatorBookingSlot[], idx: number): OperatorBookingSlot[] {
  return slots.filter((_, i) => i !== idx);
}

/** The price charged: an operator override if set, else service base + checklist adder (dollars). */
export function effectiveTotalUsd(
  s: OperatorBookingState,
  service: ServiceType | null,
  checklist?: { price_adder: number } | null,
): number {
  if (s.priceOverride != null) return s.priceOverride;
  return (service?.base_price ?? 0) + (checklist?.price_adder ?? 0);
}

/**
 * The blocking price message for the form, or null. Only once a service is chosen: before
 * that the price field is empty and there is nothing to correct yet.
 */
export function bookingPriceError(
  s: OperatorBookingState,
  service: ServiceType | null,
  checklist?: { price_adder: number } | null,
): string | null {
  if (!s.serviceTypeId) return null;
  return jobPriceError(effectiveTotalUsd(s, service, checklist));
}

/**
 * Whether the form can move to Review. Takes the service and checklist so the price rule
 * (every job at least $1, see minJobPrice) gates on the same total that gets written.
 */
export function canReview(
  s: OperatorBookingState,
  service: ServiceType | null,
  checklist?: { price_adder: number } | null,
): boolean {
  const hasCustomer = isSelfPay(s) ? true : !!s.customerId;
  return (
    hasCustomer &&
    !!s.propertyId &&
    !!s.serviceTypeId &&
    !!s.checklistId &&
    s.slots.length >= 1 &&
    !!s.cleanerId &&
    bookingPriceError(s, service, checklist) === null
  );
}

export function canCreate(
  s: OperatorBookingState,
  service: ServiceType | null,
  checklist?: { price_adder: number } | null,
): boolean {
  if (!canReview(s, service, checklist)) return false;
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
export function canCreateBooking(
  s: OperatorBookingState,
  occurrenceCount: number,
  service: ServiceType | null,
  checklist?: { price_adder: number } | null,
): boolean {
  if (!canCreate(s, service, checklist)) return false;
  if (isSelfPay(s)) return true;
  if (!s.recurrence.enabled) return true;
  return occurrenceCount >= 1;
}
