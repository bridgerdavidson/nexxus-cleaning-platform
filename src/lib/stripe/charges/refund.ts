/**
 * Refund helper (Phase 4).
 *
 * In the separate-charges-and-transfers model the homeowner charge lives on the PLATFORM
 * balance, so a plain refund pulls from the platform. Before refunding, the route reverses the
 * outbound transfers for the job (tenant + cleaner) via `reversePlatformTransfer` so the platform
 * is made whole — `reverse_transfer` / `refund_application_fee` (destination-charge concepts)
 * don't apply here and are intentionally omitted.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

export interface CreateRefundParams {
  paymentIntentId: string;
  /** Omit for a full refund. */
  amountCents?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  metadata?: Record<string, string>;
  /** Idempotency key so a double-submit can't create a second refund up to the same cap. */
  idempotencyKey?: string;
}

export async function createRefund(params: CreateRefundParams): Promise<Stripe.Refund> {
  const stripe = getStripe();
  const p: Stripe.RefundCreateParams = { payment_intent: params.paymentIntentId };
  if (typeof params.amountCents === 'number') p.amount = params.amountCents;
  if (params.reason) p.reason = params.reason;
  if (params.metadata) p.metadata = params.metadata;
  return stripe.refunds.create(p, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
}
