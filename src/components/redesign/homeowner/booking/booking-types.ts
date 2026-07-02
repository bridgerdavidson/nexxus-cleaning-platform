import type { PaymentMethodKind } from '@/lib/payments/processingFee';

export interface BookingSlot {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h) */
  time: string;
}

export interface BookingState {
  propertyId: string | null;
  serviceTypeId: string | null;
  slots: BookingSlot[];
  notes: string;
  paymentMethodId: string | null;
  /** For the fee-aware total; defaults to 'card' (the costlier fee, never under-quote). */
  method: PaymentMethodKind;
}

export const MAX_SLOTS = 3;

export const EMPTY_BOOKING: BookingState = {
  propertyId: null,
  serviceTypeId: null,
  slots: [],
  notes: '',
  paymentMethodId: null,
  method: 'card',
};
