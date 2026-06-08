/**
 * Single source of truth for the payment-status chip rendered on appointment cards
 * (AppointmentCard on desktop, CompactAppointmentRow on mobile/tablet). One helper so the
 * two surfaces can never diverge and so every appointment shows ONE meaningful chip.
 *
 * It folds two orthogonal dimensions into a single label:
 *   - `payment_status` — the charge/settlement state (pending | processing | paid | failed | refunded)
 *   - `authorization_status` — the card-hold state of the new charge flow, only meaningful while
 *     the payment is still unresolved (a hold is placed, then captured into a paid charge)
 *
 * Priority: a resolved payment wins (paid/refunded/failed/processing). Otherwise we reflect the
 * card-hold state so a live hold reads "Card held" instead of the misleading "Unpaid", and an
 * ACH debit in flight reads "Clearing". Anything with no hold and no charge yet is "Unpaid".
 */

export type PillPaymentStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'refunded'
  | null
  | undefined;

export type PillAuthorizationStatus =
  | 'none'
  | 'scheduled'
  | 'authorizing'
  | 'requires_action'
  | 'authorized'
  | 'captured'
  | 'canceled'
  | 'failed'
  | null
  | undefined;

export interface PaymentPill {
  label: string;
  /** Combined Tailwind background + text classes for the chip. */
  className: string;
}

export function paymentStatusPill(
  paymentStatus: PillPaymentStatus,
  authorizationStatus?: PillAuthorizationStatus,
): PaymentPill {
  // 1) A resolved charge always wins over any hold state.
  switch (paymentStatus) {
    case 'paid':
      return { label: 'Paid', className: 'bg-green-100 text-green-700' };
    case 'refunded':
      return { label: 'Refunded', className: 'bg-blue-100 text-blue-700' };
    case 'failed':
      return { label: 'Failed', className: 'bg-red-100 text-red-700' };
    case 'processing':
      // ACH debit clearing (~4 business days). Not "Unpaid" — money is in flight.
      return { label: 'Clearing', className: 'bg-amber-100 text-amber-700' };
  }

  // 2) Payment not yet resolved (pending / null): reflect the card-hold state so the chip is
  //    never a misleading "Unpaid" while a hold is live.
  switch (authorizationStatus) {
    case 'authorized':
      return { label: 'Card held', className: 'bg-blue-100 text-blue-700' };
    case 'requires_action':
      return { label: 'Action needed', className: 'bg-amber-100 text-amber-700' };
    case 'authorizing':
      return { label: 'Authorizing', className: 'bg-gray-100 text-gray-600' };
    case 'captured':
      // Captured but the paid row hasn't landed yet — treat as settled, not unpaid.
      return { label: 'Captured', className: 'bg-green-100 text-green-700' };
    case 'failed':
      return { label: 'Auth failed', className: 'bg-red-100 text-red-700' };
  }

  // 3) No charge and no hold (none / scheduled / canceled / null).
  return { label: 'Unpaid', className: 'bg-gray-100 text-gray-700' };
}
