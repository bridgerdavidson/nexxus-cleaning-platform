import type { TxnBadgeKey } from '@/components/redesign/payments/payments-types';

/** Minimal homeowner payment shape used by the receipts list + detail. */
export interface PaymentLike {
  id: string;
  amount: number;
  status: string;
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
