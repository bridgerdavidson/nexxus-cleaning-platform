/**
 * Refund helpers (Phase 4).
 *
 * A refund on the platform PaymentIntent with `reverse_transfer` claws the refunded
 * amount back from the tenant's balance, and `refund_application_fee` returns the
 * platform's proportional fee. Stripe does NOT auto-reverse our separate tenant→cleaner
 * transfer, so the route also reverses that (cleaner clawback, decision #12) — which can
 * push the cleaner's connected account negative, recovered from their future earnings.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

export interface CreateRefundParams {
  paymentIntentId: string;
  /** Omit for a full refund. */
  amountCents?: number;
  reverseTransfer: boolean;
  refundApplicationFee: boolean;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  metadata?: Record<string, string>;
}

export async function createRefund(params: CreateRefundParams): Promise<Stripe.Refund> {
  const stripe = getStripe();
  const p: Stripe.RefundCreateParams = {
    payment_intent: params.paymentIntentId,
    reverse_transfer: params.reverseTransfer,
    refund_application_fee: params.refundApplicationFee,
  };
  if (typeof params.amountCents === 'number') p.amount = params.amountCents;
  if (params.reason) p.reason = params.reason;
  if (params.metadata) p.metadata = params.metadata;
  return stripe.refunds.create(p);
}

/**
 * Reverse (part of) a tenant→cleaner transfer — created on the tenant account.
 */
export async function reverseCleanerTransfer(
  transferId: string,
  amountCents: number,
  tenantAccountId: string,
): Promise<Stripe.TransferReversal> {
  const stripe = getStripe();
  return stripe.transfers.createReversal(
    transferId,
    { amount: amountCents },
    { stripeAccount: tenantAccountId },
  );
}
