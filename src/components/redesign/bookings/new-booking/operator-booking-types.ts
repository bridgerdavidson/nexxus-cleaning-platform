import type { PaymentMethodKind } from '@/lib/payments/processingFee';

export interface OperatorBookingSlot {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm (24h) */
  time: string;
}

export type CadencePreset = 'weekly' | 'biweekly' | 'every4' | 'custom';
export type RecurrenceEnd = 'after' | 'on_date' | 'keep_going';
export type CustomRecurrenceType = 'daily' | 'weekly' | 'monthly';

export interface OperatorRecurrence {
  enabled: boolean;
  preset: CadencePreset;
  /** Only used when preset === 'custom'. */
  customType: CustomRecurrenceType;
  /** Only used when preset === 'custom'. Every N days/weeks/months. */
  customInterval: number;
  /** Explicit weekly day selection (0=Sun..6=Sat). Empty means "default to the start date's weekday". */
  daysOfWeek: number[];
  end: RecurrenceEnd;
  /** For end === 'after'. */
  count: number;
  /** For end === 'on_date' (YYYY-MM-DD). */
  endDate: string | null;
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
  /** Recurrence config (customer-billed only; ignored in self-pay). */
  recurrence: OperatorRecurrence;
}

export const MAX_OPERATOR_SLOTS = 3;

export const DEFAULT_RECURRENCE: OperatorRecurrence = {
  enabled: false,
  preset: 'weekly',
  customType: 'weekly',
  customInterval: 2,
  daysOfWeek: [],
  end: 'after',
  count: 8,
  endDate: null,
};

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
  recurrence: DEFAULT_RECURRENCE,
};
