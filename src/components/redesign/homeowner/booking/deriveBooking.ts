import { computeChargeBreakdown, type PaymentMethodKind } from '@/lib/payments/processingFee';
import { formatTimeTo12h } from '@/lib/formatTime';
import { MAX_SLOTS, type BookingSlot, type BookingState } from './booking-types';

export function addSlot(slots: BookingSlot[], slot: BookingSlot): BookingSlot[] {
  return slots.length >= MAX_SLOTS ? slots : [...slots, slot];
}

export function removeSlotAt(slots: BookingSlot[], idx: number): BookingSlot[] {
  return slots.filter((_, i) => i !== idx);
}

export function canReview(s: BookingState): boolean {
  return !!s.propertyId && !!s.serviceTypeId && s.slots.length >= 1;
}

export function canSend(s: BookingState, paymentRequired: boolean): boolean {
  return canReview(s) && (!paymentRequired || !!s.paymentMethodId);
}

const ORDINALS = ['1st', '2nd', '3rd'];
export function slotOrdinal(idx: number): string {
  return ORDINALS[idx] ?? `${idx + 1}th`;
}

/** "Sat, Jul 5 · 10:00 AM" */
export function formatSlotLabel(slot: BookingSlot): string {
  const [y, m, d] = slot.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const datePart = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${datePart} · ${formatTimeTo12h(slot.time)}`;
}

export interface BookingTotal {
  baseUsd: number;
  feeUsd: number;
  totalUsd: number;
}

/** Fee-aware total in dollars. `baseUsd` is the service price; the payer covers the fee. */
export function bookingTotal(baseUsd: number, method: PaymentMethodKind): BookingTotal {
  const b = computeChargeBreakdown(method, Math.round(baseUsd * 100));
  return { baseUsd: b.baseCents / 100, feeUsd: b.feeCents / 100, totalUsd: b.chargeCents / 100 };
}
