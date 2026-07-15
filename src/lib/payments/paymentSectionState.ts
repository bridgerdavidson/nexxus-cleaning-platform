export type PaymentSectionState =
  | 'failed'
  | 'requires_action'
  | 'processing'
  | 'before_charge'
  | 'paid'
  | 'no_card'
  | 'self_pay';

/**
 * Which payment sub-state a booking is in, for both the operator and homeowner
 * payment sections. Order matters: self-pay short-circuits (company-funded),
 * then explicit authorization failures, then settled/processing, then the
 * pre-charge states.
 */
export function derivePaymentSectionState(input: {
  authorizationStatus: string | null;
  paymentStatus: string | null;
  isSelfPay: boolean;
  jobCompleted: boolean;
  hasCard: boolean;
}): PaymentSectionState {
  const { authorizationStatus, paymentStatus, isSelfPay, jobCompleted, hasCard } = input;
  if (isSelfPay) return 'self_pay';
  if (authorizationStatus === 'failed') return 'failed';
  if (authorizationStatus === 'requires_action') return 'requires_action';
  if (paymentStatus === 'paid' || authorizationStatus === 'captured') return 'paid';
  if (paymentStatus === 'processing') return 'processing';
  if (!hasCard) return 'no_card';
  void jobCompleted; // reserved for future "after completion, before charge" nuance
  return 'before_charge';
}

export type ChargeOutcome = 'charged' | 'processing' | 'requires_action' | 'declined' | 'precondition';

/**
 * Maps a charge route response (its `code` + HTTP status) to how the payment
 * section should present the outcome. Never optimistically shows Paid; the
 * badge is driven by the actual returned code.
 */
export function mapChargeResponse(
  code: string | null,
  httpStatus: number,
): { outcome: ChargeOutcome; badgeTone: 'success' | 'info' | 'caution' | 'critical'; stayFailed: boolean } {
  if (code === 'charged') return { outcome: 'charged', badgeTone: 'success', stayFailed: false };
  if (code === 'processing') return { outcome: 'processing', badgeTone: 'info', stayFailed: false };
  if (code === 'requires_action') return { outcome: 'requires_action', badgeTone: 'caution', stayFailed: false };
  // tenant_not_ready / no_card / no_org_card / no_org_bank / cleaner_not_payable / not_chargeable
  if (httpStatus === 409) return { outcome: 'precondition', badgeTone: 'critical', stayFailed: true };
  // declined card, 5xx Stripe/system failure, or any other non-success: stay Failed, show the returned message
  return { outcome: 'declined', badgeTone: 'critical', stayFailed: true };
}
