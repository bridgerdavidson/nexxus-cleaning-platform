/**
 * Cancel a manual-capture PaymentIntent that is still in `requires_capture`
 * (releases the card hold; no money moves). Used when an appointment is cancelled
 * or its authorization is superseded by a re-auth.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

export async function cancelAuthorization(
  paymentIntentId: string,
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.cancel(paymentIntentId);
}
