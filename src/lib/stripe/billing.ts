/**
 * SaaS subscription billing — Stripe SDK wrappers (Phase 5, Scenario 3: the tenant ORG pays
 * Nexxus monthly). Thin getStripe() calls live here so the billing routes + webhook mirroring
 * can be integration-tested with these mocked (the global test setup stubs getStripe() to throw).
 *
 * The org's billing Customer (`organizations.stripe_customer_id`) is DISTINCT from its Connect
 * account (`stripe_connect_account_id`, which RECEIVES homeowner money). One pays us; the other
 * gets paid. Backend scaffolding only — no UI in v1 (the routes work for internal/testing use).
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { LOOKUP_KEYS, type LookupKey } from '@/lib/billing/plans';

export async function createStripeBillingCustomer(params: {
  organizationId: string;
  name: string;
  email?: string | null;
}): Promise<Stripe.Customer> {
  const stripe = getStripe();
  return stripe.customers.create({
    name: params.name || undefined,
    email: params.email || undefined,
    metadata: {
      organization_id: params.organizationId,
      customer_role: 'tenant_billing',
      source: 'nexxus-cleaning-platform',
    },
  });
}

export async function cancelStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.cancel(subscriptionId);
}

export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

// ---------------------------------------------------------------------------
// Price + portal resolution (Phase 1b SaaS billing)
// ---------------------------------------------------------------------------

let priceCache: Record<LookupKey, string> | null = null;
let portalConfigCache: string | null = null;

/** Test-only. Clears the per-process caches so specs are not order-dependent. */
export function __resetBillingCaches(): void {
  priceCache = null;
  portalConfigCache = null;
}

/**
 * Every plan Price, keyed by lookup key.
 *
 * No env vars and no config table: test mode and live mode differ only in which
 * account the SDK key points at. A half-configured account throws here rather
 * than silently creating a subscription that is missing its seat item.
 */
export async function resolvePrices(): Promise<Record<LookupKey, string>> {
  if (priceCache) return priceCache;

  const stripe = getStripe();
  const result = await stripe.prices.list({
    lookup_keys: [...LOOKUP_KEYS],
    active: true,
    limit: 100,
  });

  const found = {} as Record<LookupKey, string>;
  for (const price of result.data) {
    if (price.lookup_key && (LOOKUP_KEYS as readonly string[]).includes(price.lookup_key)) {
      found[price.lookup_key as LookupKey] = price.id;
    }
  }

  const missing = LOOKUP_KEYS.filter((key) => !found[key]);
  if (missing.length > 0) {
    throw new Error(
      `Stripe is missing ${missing.length} billing price(s): ${missing.join(', ')}. ` +
        'Run scripts/stripe-billing-setup.ts against this account.',
    );
  }

  priceCache = found;
  return found;
}

/** The Customer Portal configuration tagged `nexxus_portal = 'default'`. */
export async function resolvePortalConfiguration(): Promise<string> {
  if (portalConfigCache) return portalConfigCache;

  const stripe = getStripe();
  const result = await stripe.billingPortal.configurations.list({ limit: 100 });
  const mine = result.data.find((c) => c.metadata?.nexxus_portal === 'default');

  if (!mine) {
    throw new Error(
      'No Customer Portal configuration tagged nexxus_portal=default. ' +
        'Run scripts/stripe-billing-setup.ts against this account.',
    );
  }

  portalConfigCache = mine.id;
  return mine.id;
}

// ---------------------------------------------------------------------------
// Hosted Checkout (Phase 1b SaaS billing)
// ---------------------------------------------------------------------------

export interface BillingCheckoutInput {
  customerId: string;
  lineItems: Array<{ price: string; quantity: number }>;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
  automaticTax: boolean;
}

/**
 * Hosted Checkout for the first subscription purchase.
 *
 * No trial_period_days: the app manages the trial and it is over by the time
 * anyone reaches checkout. No payment_method_types: Stripe picks eligible
 * methods from Dashboard settings, and hardcoding card would cost conversion.
 *
 * `integration_identifier` is deliberately omitted: the installed SDK is pinned
 * to apiVersion 2025-12-15.clover and that parameter needs a much newer version,
 * which would move every charge, transfer, Connect and payout call with it.
 */
export async function createBillingCheckoutSession(
  input: BillingCheckoutInput,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    customer: input.customerId,
    customer_update: { address: 'auto', name: 'auto' },
    // Collected from day one so the address data already exists when Stripe Tax
    // is switched on later.
    billing_address_collection: 'required',
    line_items: input.lineItems,
    subscription_data: { metadata: { organization_id: input.organizationId } },
    metadata: { organization_id: input.organizationId },
    // The launch offer is a Stripe coupon, not code.
    allow_promotion_codes: true,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };

  // Passed only behind the flag: without an active Stripe Tax registration
  // Stripe silently collects nothing and returns no error.
  if (input.automaticTax) {
    params.automatic_tax = { enabled: true };
  }

  return stripe.checkout.sessions.create(params);
}

// ---------------------------------------------------------------------------
// Plan change (Phase 1b SaaS billing)
// ---------------------------------------------------------------------------

/**
 * The subscription as Stripe has it. `items.data[].price.lookup_key` rides along
 * on a plain retrieve, so reading the current plan needs no extra fetch.
 */
export async function retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.retrieve(subscriptionId);
}

/**
 * One call handles tier up, tier down, seats up, seats down, and the interval
 * switch. Prorated immediately in both directions, which is what lets us avoid
 * Subscription Schedules entirely.
 */
export async function updateSubscriptionItems(
  subscriptionId: string,
  items: Stripe.SubscriptionUpdateParams.Item[],
  organizationId: string,
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, {
    items,
    proration_behavior: 'create_prorations',
    metadata: { organization_id: organizationId },
  });
}

// ---------------------------------------------------------------------------
// Pause, resume, cancel (Phase 1b SaaS billing)
// ---------------------------------------------------------------------------

/**
 * Pause collection on a live subscription.
 *
 * `behavior: 'void'` means Stripe writes NO invoices at all for the paused
 * months, rather than stacking drafts that all come due on resume. That is what
 * makes a pause clean to reverse: nothing accrues while the org is away.
 *
 * `resumesAt` is a unix timestamp (seconds). Omitted entirely when null, which
 * leaves the pause open-ended until someone resumes it.
 */
export async function pauseSubscription(
  subscriptionId: string,
  resumesAt: number | null,
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, {
    pause_collection: { behavior: 'void', ...(resumesAt ? { resumes_at: resumesAt } : {}) },
  });
}

/**
 * Resume collection.
 *
 * Clearing pause_collection is an EMPTY STRING, not null and not undefined:
 * undefined is dropped from the request body by the SDK (so the pause survives)
 * and null is not what the API documents for this field. The installed types
 * accept it because the parameter is `Emptyable<PauseCollection>`.
 */
export async function resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, { pause_collection: '' });
}

/**
 * Schedule cancellation for the end of the paid period. The subscription stays
 * `active` until then, so the org keeps the service it already paid for; Stripe
 * sets `cancel_at`, which the webhook mirrors onto `subscription_cancel_at`.
 *
 * Cancelling immediately is `cancelStripeSubscription` above: same SDK call,
 * one wrapper, no second name for it.
 */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return getStripe().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}
