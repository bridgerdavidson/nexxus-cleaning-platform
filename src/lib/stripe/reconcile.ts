/**
 * Stripe read wrappers for the reconciliation sweep (Phase 4d).
 *
 * Thin getStripe() accessors kept in their own module so the cron route and the reconcile
 * helpers can be integration-tested with these mocked — the global test setup stubs
 * getStripe() to throw, so we never touch the real network in tests.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

/** Re-fetch a Stripe event so a failed/missed webhook can be re-dispatched. */
export async function retrieveStripeEvent(eventId: string): Promise<Stripe.Event> {
  return getStripe().events.retrieve(eventId);
}

/** Retrieve a PaymentIntent (latest_charge expanded) to reconcile our local record against. */
export async function retrievePaymentIntent(
  paymentIntentId: string,
): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
}

/** Retrieve a charge (amount_refunded) so settlement can shrink to what wasn't already refunded. */
export async function retrieveCharge(chargeId: string): Promise<Stripe.Charge> {
  return getStripe().charges.retrieve(chargeId);
}
