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
 * Find every completion PaymentIntent for an appointment via metadata search (T1-16). The
 * unknown-outcome verification sweep uses this to discover a charge that Stripe captured but
 * whose response we lost (the local row has no PI id to retrieve by). `charge_kind` scoping
 * keeps cancellation-fee PIs out. Search indexing lags live writes by ~1 minute, which the
 * sweep's age grace covers.
 */
export async function searchPaymentIntentsByAppointment(
  appointmentId: string,
): Promise<Stripe.PaymentIntent[]> {
  const res = await getStripe().paymentIntents.search({
    query: `metadata['appointment_id']:'${appointmentId}' AND metadata['charge_kind']:'completion'`,
    limit: 100,
  });
  return res.data;
}

/**
 * Recent PaymentIntents for a Customer via the LIST endpoint, which unlike search is strongly
 * consistent (read-after-write). The unknown-outcome sweep merges this with the search results so
 * a capture created seconds ago is found immediately, and requires it as corroboration before
 * concluding that NO charge exists — search alone can return an empty result set for hours during
 * a Stripe indexing backlog, and a false "absent" verdict is what re-arms a fresh-key charge.
 */
export async function listRecentPaymentIntentsForCustomer(
  customerId: string,
  createdAfterEpochSec: number,
): Promise<Stripe.PaymentIntent[]> {
  const res = await getStripe().paymentIntents.list({
    customer: customerId,
    created: { gte: createdAfterEpochSec },
    limit: 100,
  });
  return res.data;
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

/**
 * List a connected account's recent payouts (any status), newest first, single page. The
 * bank-paid reconcile backstop (T1-3) uses this to discover payouts whose webhook delivery
 * we missed; one bounded page keeps the sweep's Stripe cost fixed per cleaner.
 */
export async function listConnectedAccountPayouts(
  connectedAccountId: string,
  opts: { createdAfterEpochSec?: number; limit?: number } = {},
): Promise<Stripe.Payout[]> {
  const res = await getStripe().payouts.list(
    {
      limit: opts.limit ?? 100,
      ...(opts.createdAfterEpochSec ? { created: { gte: opts.createdAfterEpochSec } } : {}),
    },
    { stripeAccount: connectedAccountId },
  );
  return res.data;
}

/**
 * Retrieve a single payout on a connected account. The bank-bounce recheck (T1-3) uses this
 * to notice a recently-stamped bank_paid payout flipping to failed/canceled at the bank,
 * which otherwise only the (possibly unsubscribed) payout.failed webhook would report.
 */
export async function retrieveConnectedAccountPayout(
  connectedAccountId: string,
  payoutId: string,
): Promise<Stripe.Payout> {
  return getStripe().payouts.retrieve(payoutId, {}, { stripeAccount: connectedAccountId });
}
