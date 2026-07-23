/**
 * Stripe read wrappers for the reconciliation sweep (Phase 4d).
 *
 * Thin getStripe() accessors kept in their own module so the cron route and the reconcile
 * helpers can be integration-tested with these mocked — the global test setup stubs
 * getStripe() to throw, so we never touch the real network in tests.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

/**
 * Re-fetch a Stripe event so a failed/missed webhook can be re-dispatched.
 *
 * T1-10: Connect-delivered events (payout.paid/failed, account.updated, and connected-account
 * transfer.reversed) live on the CONNECTED account, not the platform. Retrieving them without the
 * `Stripe-Account` header 404s, so a dead-lettered Connect event could never be recovered by the
 * sweep. Pass the stored `account_id` as `stripeAccount` when present; platform events (no account)
 * retrieve as before.
 */
export async function retrieveStripeEvent(
  eventId: string,
  opts?: { stripeAccount?: string | null },
): Promise<Stripe.Event> {
  const account = opts?.stripeAccount;
  return account
    ? getStripe().events.retrieve(eventId, {}, { stripeAccount: account })
    : getStripe().events.retrieve(eventId);
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

/**
 * List a PaymentIntent's refunds — the authoritative refund history including out-of-band
 * Dashboard refunds (the local `refunds` ledger can miss those). The retry sweep uses the
 * `created` timestamps for its safety guards. 100 covers any realistic refund count per charge.
 */
export async function listRefundsForPaymentIntent(paymentIntentId: string): Promise<Stripe.Refund[]> {
  const res = await getStripe().refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  return res.data;
}
