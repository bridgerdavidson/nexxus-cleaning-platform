/**
 * Single source of truth for the payment-status chip rendered on appointment cards
 * (AppointmentCard on desktop, CompactAppointmentRow on mobile/tablet). One helper so the two
 * surfaces can never diverge and so every appointment shows ONE meaningful chip.
 *
 * Cards are SAVED (not held) at booking and charged when the job completes, so there is no separate
 * card-hold state to reflect: the chip is driven entirely by `payment_status`. An upcoming
 * appointment with a saved card reads "Unpaid" (it is charged at completion); an ACH debit in flight
 * reads "Clearing".
 */

export type PillPaymentStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'refunded'
  | null
  | undefined;

export interface PaymentPill {
  label: string;
  /** Combined Tailwind background + text classes for the chip. */
  className: string;
}

export function paymentStatusPill(paymentStatus: PillPaymentStatus): PaymentPill {
  switch (paymentStatus) {
    case 'paid':
      return { label: 'Paid', className: 'bg-green-100 text-green-700' };
    case 'refunded':
      return { label: 'Refunded', className: 'bg-blue-100 text-blue-700' };
    case 'failed':
      return { label: 'Failed', className: 'bg-red-100 text-red-700' };
    case 'processing':
      // ACH debit clearing (~4 business days). Not "Unpaid"; money is in flight.
      return { label: 'Clearing', className: 'bg-amber-100 text-amber-700' };
    default:
      // pending / null: no charge yet (an upcoming job is charged when it is completed).
      return { label: 'Unpaid', className: 'bg-gray-100 text-gray-700' };
  }
}
