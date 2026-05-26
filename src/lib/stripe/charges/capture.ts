/**
 * Capture a previously-authorized (manual-capture) PaymentIntent on job completion.
 *
 * Supports capturing LESS than authorized (job scope shrank) by passing
 * `amountToCaptureCents`; the unused hold is released automatically by Stripe.
 * Capturing more than authorized is impossible — that requires a separate
 * incremental charge (handled at the route layer).
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

export async function capturePaymentIntent(
  paymentIntentId: string,
  amountToCaptureCents?: number,
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const params: Stripe.PaymentIntentCaptureParams = {};
  if (typeof amountToCaptureCents === 'number') {
    params.amount_to_capture = amountToCaptureCents;
  }

  return stripe.paymentIntents.capture(paymentIntentId, params, {
    idempotencyKey: `capture-${paymentIntentId}`,
  });
}
