import { computeCancellationFee } from '@/lib/payments/cancellationFee';
import type { AdminAppointment } from '@/hooks/useAdminData';

export type CancelParty = 'homeowner' | 'cleaner' | 'org';
export type FeeType = 'none' | 'flat' | 'percent';

export interface CancelPolicy {
  windowHours: number;
  feeType: FeeType;
  feeValue: number;
  // No-show fee policy, independent of the late-cancel fee (T1-6, decision B).
  noShowFeeType: FeeType;
  noShowFeeValue: number;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/**
 * Fee preview for the operator cancel dialog, mirroring the server's rules in
 * /api/appointments/[appointmentId]/cancel: self-pay and completed bookings
 * always cancel for $0 (no homeowner to charge / the completion-refund flow
 * owns that money), otherwise the shared computeCancellationFee decides.
 */
export function previewCancelFee(
  a: Pick<AdminAppointment, 'total_price' | 'scheduled_date' | 'scheduled_time' | 'is_self_pay' | 'status'>,
  policy: CancelPolicy,
  party: CancelParty,
  noShow: boolean,
): { feeCents: number; insideWindow: boolean } {
  if (a.is_self_pay || a.status === 'completed') return { feeCents: 0, insideWindow: false };
  return computeCancellationFee({
    party,
    noShow,
    grossCents: Math.round(Number(a.total_price ?? 0) * 100),
    windowHours: policy.windowHours,
    feeType: policy.feeType,
    feeValue: policy.feeValue,
    noShowFeeType: policy.noShowFeeType,
    noShowFeeValue: policy.noShowFeeValue,
    scheduledDate: a.scheduled_date ?? null,
    scheduledTime: a.scheduled_time ?? null,
  });
}

/** Explains the previewed fee above the footer. */
export function feeLine(feeCents: number, windowHours: number, noShow: boolean): string {
  if (feeCents <= 0) return 'No fee applies to this cancellation.';
  if (noShow) return `A ${formatUsd(feeCents)} no-show fee will be charged to the customer's card on file.`;
  return `Cancelling within ${windowHours} hours of the appointment charges the customer a ${formatUsd(feeCents)} fee on their card on file.`;
}

export interface CancelRouteResult {
  fee_captured_cents?: number;
  fee_outcome?: string;
  fee_message?: string;
  inflight_debit?: boolean;
  inflight_message?: string;
}

/**
 * The route cancels the booking even when the fee could not be collected
 * (missing card, decline, bank-only payer), so every success response is a
 * "cancelled" toast; the variant and detail describe how the fee went.
 */
export function cancelToast(r: CancelRouteResult): { tone: 'success' | 'warning'; message: string; description?: string } {
  if (r.inflight_debit) {
    return {
      tone: 'success',
      message: 'Booking cancelled',
      description: r.inflight_message ?? 'The bank payment in progress will be refunded when it settles.',
    };
  }
  if ((r.fee_captured_cents ?? 0) > 0) {
    return { tone: 'success', message: `Booking cancelled. ${formatUsd(r.fee_captured_cents!)} fee charged.` };
  }
  if (r.fee_outcome === 'failed') {
    return {
      tone: 'warning',
      message: 'Booking cancelled, but the fee was not collected',
      description: r.fee_message ?? 'The card charge failed.',
    };
  }
  if (r.fee_outcome === 'uncollectable') {
    return {
      tone: 'warning',
      message: 'Booking cancelled, but the fee was not collected',
      description: 'No chargeable card on file for this customer.',
    };
  }
  return { tone: 'success', message: 'Booking cancelled' };
}
