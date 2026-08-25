import type { ServiceType } from '@/hooks/useServices';
import { isCleanerPayable, type CleanerPayoutFields } from '@/lib/payments/isCleanerPayable';
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

/** The price charged: an operator override if set, else service base + checklist adder (dollars). */
export function effectiveTotalUsd(
  s: OperatorBookingState,
  service: ServiceType | null,
  checklist?: { price_adder: number } | null,
): number {
  if (s.priceOverride != null) return s.priceOverride;
  return (service?.base_price ?? 0) + (checklist?.price_adder ?? 0);
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

/**
 * Why a cleaner cannot be offered a company-pays (self-pay) job, or null when they can.
 *
 * A self-pay job's only money movement is company card -> cleaner Connect account, so the
 * picker refuses cleaners settlement could not pay. The yes/no comes from isCleanerPayable
 * (the same predicate settleSelfPay uses), so the row is never grayed for a cleaner who
 * would be paid (flat / request modes have payout_percent 0) and never offered to one who
 * would not. The text is the row's sublabel: it says what to fix, in the same words the
 * Cleaners page uses for the matching state.
 */
export function selfPayCleanerBlockReason(c: CleanerPayoutFields): string | null {
  if (isCleanerPayable(c)) return null;
  if (!c.payout_configured_at) return 'Pay not set';
  if (c.payout_model === 'hourly_external') return 'Paid off platform';
  if (!c.stripe_connect_account_id) return 'No Stripe payout account yet';
  if (c.stripe_connect_onboarding_complete !== true) return 'Stripe payout setup not finished';
  if (c.payout_model === 'flat') return 'Flat rate not set';
  return 'Pay set to 0%';
}
