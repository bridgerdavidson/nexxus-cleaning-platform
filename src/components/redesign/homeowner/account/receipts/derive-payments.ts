import type { TxnBadgeKey } from '@/components/redesign/payments/payments-types';

/** Minimal homeowner payment shape used by the receipts list + detail. */
export interface PaymentLike {
  id: string;
  amount: number;
  status: string;
  /** 'completion' | 'cancellation_fee' | null (legacy rows). Drives the receipt label. */
  charge_kind?: string | null;
  /** Stripe processing fee grossed onto the charge, in cents. Drives the fee breakdown. */
  processing_fee_cents?: number | null;
  is_self_pay?: boolean | null;
  paid_at?: string | null;
  created_at: string;
  appointment?: {
    scheduled_date?: string | null;
    service_type?: { name?: string | null } | null;
  } | null;
}

const TXN_KEYS = new Set<TxnBadgeKey>(['paid', 'processing', 'pending', 'failed', 'refunded']);

/** Map a raw payment status to a known transaction badge key (defaults to 'pending'). */
export function paymentBadgeKey(status: string): TxnBadgeKey {
  return TXN_KEYS.has(status as TxnBadgeKey) ? (status as TxnBadgeKey) : 'pending';
}

/** The service name for a payment, or a generic fallback. */
export function paymentServiceLabel(p: PaymentLike): string {
  return p.appointment?.service_type?.name?.trim() || 'Cleaning';
}

/** A cancellation/no-show fee charge rather than a normal cleaning payment. */
export function isCancellationFee(p: PaymentLike): boolean {
  return p.charge_kind === 'cancellation_fee';
}

/**
 * The primary label for a payment: "Cancellation fee" for a fee charge, otherwise the cleaning
 * service name. Without this a cancellation fee renders identically to a full cleaning payment.
 */
export function paymentKindLabel(p: PaymentLike): string {
  return isCancellationFee(p) ? 'Cancellation fee' : paymentServiceLabel(p);
}

export interface PaymentFeeBreakdown {
  /** The service/fee amount before the processing fee, in dollars. */
  subtotal: number;
  /** The processing fee grossed onto the charge, in dollars. */
  fee: number;
  /** The total actually charged (equals payment.amount), in dollars. */
  total: number;
}

/**
 * Split a charged amount into subtotal + processing fee when the row carries a fee. The charge
 * amount is grossed up for the Stripe fee, so subtotal = amount - fee. Returns null when there is
 * no fee to show (fee-passthrough off, legacy row, or a zero fee) so the receipt stays clean.
 */
export function paymentFeeBreakdown(p: PaymentLike): PaymentFeeBreakdown | null {
  const feeCents = p.processing_fee_cents;
  if (feeCents == null || feeCents <= 0) return null;
  const total = Number(p.amount) || 0;
  const fee = feeCents / 100;
  const subtotal = Math.max(0, Math.round((total - fee) * 100) / 100);
  return { subtotal, fee, total };
}
