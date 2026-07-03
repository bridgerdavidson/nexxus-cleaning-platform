import type { PaymentMethodKind } from '@/lib/payments/processingFee';

export interface OperatorBookingSlot {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm (24h) */
  time: string;
}

export interface OperatorBookingState {
  billTo: 'customer' | 'self_pay';
  /** The customer/homeowner. Required when billing the customer; optional in self-pay (null = org-owned). */
  customerId: string | null;
  propertyId: string | null;
  serviceTypeId: string | null;
  checklistId: string | null;
  /** Operator price override in dollars, or null to use the service base price. */
  priceOverride: number | null;
  /** Primary time at index 0, then up to 2 alternates. */
  slots: OperatorBookingSlot[];
  /** The cleaner the booking is offered to first. */
  cleanerId: string | null;
  notes: string;
  /** Customer-billed payment selection from AppointmentPaymentSection (a card id, or a send-link/defer sentinel). */
  paymentValue: string | null;
  /** Self-pay: whether the org has a charged payment method on file. */
  selfPayHasMethod: boolean;
  /** Method used for the fee-aware total (card vs bank). */
  method: PaymentMethodKind;
}

export const MAX_OPERATOR_SLOTS = 3;

export const EMPTY_OPERATOR_BOOKING: OperatorBookingState = {
  billTo: 'customer',
  customerId: null,
  propertyId: null,
  serviceTypeId: null,
  checklistId: null,
  priceOverride: null,
  slots: [],
  cleanerId: null,
  notes: '',
  paymentValue: null,
  selfPayHasMethod: false,
  method: 'card',
};
