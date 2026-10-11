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
import type { PortalVariant } from '@/lib/billing/portalConfigurations';

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

/**
 * A Customer Portal session.
 *
 * `configuration` is what makes the portal behave the way the spec requires:
 * plan changes are turned OFF there (they belong in the app, where the seat
 * rules live), the cancellation-reason survey is turned on, and on the admin
 * variant cancellation itself is off (ruling R24). Without it Stripe falls back
 * to the account default configuration, which enforces none of that, and
 * nothing about the session looks wrong from our side. It is REQUIRED rather
 * than optional for exactly that reason: get it from
 * resolvePortalConfiguration(variant), which throws on an account the setup
 * script has not been run against.
 */
export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
  configuration: string;
}): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
    configuration: params.configuration,
  });
}

// ---------------------------------------------------------------------------
// Price + portal resolution (Phase 1b SaaS billing)
// ---------------------------------------------------------------------------

let priceCache: Record<LookupKey, string> | null = null;
const portalConfigCache = new Map<PortalVariant, string>();

/** Test-only. Clears the per-process caches so specs are not order-dependent. */
export function __resetBillingCaches(): void {
  priceCache = null;
  portalConfigCache.clear();
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

/**
 * The Customer Portal configuration tagged `nexxus_portal = <variant>`.
 *
 * The variant is REQUIRED rather than defaulted (ruling R24). Defaulting it
 * would mean a call site that forgot to say who it was for silently got the
 * owner portal, cancel button and all, which is the exact hole this pair of
 * configurations exists to close. Callers derive it with portalVariantForRole
 * from a server-resolved role, never from a request.
 *
 * Cached per variant, and a miss throws the way resolvePrices does rather than
 * falling back to the Stripe account default, which enforces nothing.
 */
export async function resolvePortalConfiguration(variant: PortalVariant): Promise<string> {
  const cached = portalConfigCache.get(variant);
  if (cached) return cached;

  const stripe = getStripe();
  const result = await stripe.billingPortal.configurations.list({ limit: 100 });
  const mine = result.data.find((c) => c.metadata?.nexxus_portal === variant);

  if (!mine) {
    throw new Error(
      `No Customer Portal configuration tagged nexxus_portal=${variant}. ` +
        'Run scripts/stripe-billing-setup.ts against this account.',
    );
  }

  portalConfigCache.set(variant, mine.id);
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
 * ACH is excluded by name instead (ruling R20, see the params below), because
 * that is the one dynamic method the paywall cannot survive.
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
    // ACH Direct Debit is deliberately excluded. It IS supported for
    // subscriptions, and because we pass no payment_method_types, enabling it in
    // the Dashboard would turn it on here with no code change. An ACH
    // subscription stays `active` after a failed debit (Stripe voids the invoice
    // but not the subscription), and settlement is T+4 with a 60-day consumer
    // return window, so the paywall would unfreeze an org it could never
    // re-freeze. Spec §10.8 lists the changes required before this line may be
    // removed. Never swap this for payment_method_types: that parameter disables
    // dynamic payment methods and would take the wallets down with it.
    excluded_payment_method_types: ['us_bank_account'],
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
 * Every subscription Stripe holds for a customer, newest created first.
 *
 * Only the nightly reconcile's orphan pass uses this. An organization whose
 * Checkout succeeded while its customer.subscription.created was lost has NO
 * subscription id to retrieve, so its billing Customer is the only handle left
 * on the subscription it is already paying for.
 *
 * `status: 'all'` so terminal subscriptions come back too and the caller decides
 * what counts as adoptable, rather than depending on the default filter.
 */
export async function listCustomerSubscriptions(
  customerId: string,
  limit = 10,
): Promise<Stripe.Subscription[]> {
  const result = await getStripe().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit,
  });
  return result.data;
}

/**
 * One call handles tier up, tier down, seats up, seats down, and the interval
 * switch. Prorated in both directions, which is what lets us avoid Subscription
 * Schedules entirely.
 *
 * `invoiceNow` is the whole money decision, and it is REQUIRED rather than
 * defaulted so every call site has to state its intent:
 *
 *  - true  -> `always_invoice`. Stripe writes the proration lines AND bills them
 *             right now. Without it `create_prorations` only writes the lines and
 *             leaves them for the next scheduled invoice, so an upgrade's extra
 *             money arrives a month late on monthly and up to a YEAR late on
 *             annual. Paired with `error_if_incomplete` so a declined card
 *             rejects the change instead of leaving the customer upgraded with an
 *             unpaid invoice.
 *  - false -> `create_prorations`. The credit from a downgrade lands on the next
 *             invoice; we never refund cash for one.
 *
 * The caller decides the direction, because only it knows what the org is on
 * today. See the direction table in src/app/api/billing/plan/route.ts.
 *
 * `prorationDate` is the SAME unix second previewSubscriptionChange was given,
 * when the caller has one. Stripe prorates to the second, so without it the
 * preview and the update evaluate at two different instants and the number the
 * customer was quoted is not quite the number they are charged. Stripe's
 * prorations guide says explicitly to pass the same proration_date on the
 * update. Omitted entirely when absent, never sent as undefined.
 */
export async function updateSubscriptionItems(
  subscriptionId: string,
  items: Stripe.SubscriptionUpdateParams.Item[],
  organizationId: string,
  opts: { invoiceNow: boolean; prorationDate?: number | null },
): Promise<Stripe.Subscription> {
  const params: Stripe.SubscriptionUpdateParams = {
    items,
    metadata: { organization_id: organizationId },
    proration_behavior: opts.invoiceNow ? 'always_invoice' : 'create_prorations',
  };

  if (typeof opts.prorationDate === 'number') {
    params.proration_date = opts.prorationDate;
  }

  // Set only on the invoicing path: the key must be ABSENT, not present and
  // undefined, on a downgrade.
  if (opts.invoiceNow) {
    params.payment_behavior = 'error_if_incomplete';
  }

  return getStripe().subscriptions.update(subscriptionId, params);
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

/**
 * Price a subscription change WITHOUT applying it. Read only: createPreview
 * writes nothing to Stripe.
 *
 * Mirrors the item diff updateSubscriptionItems would send, so the number the
 * customer sees is the number they are charged. `automaticTax` is passed by the
 * caller on exactly the same condition as the real Checkout Session (the flag
 * lives in the route, same as BillingCheckoutInput), otherwise the preview and
 * the charge disagree (ruling R8).
 *
 * `customer` is deliberately NOT passed: InvoiceCreatePreviewParams marks it
 * optional, and `subscription` already identifies the customer. An earlier draft
 * of the plan read it off readLiveSubscription, which does not return it.
 *
 * `proration_behavior` is ALWAYS `create_prorations` here, even for an upgrade
 * that will really be applied with `always_invoice`. The preview endpoint does
 * not return the invoice a given behaviour would cut; it returns the UPCOMING
 * invoice, which carries the proration lines AND the next period's recurring
 * lines together (see the sample response in Stripe's prorations guide, where
 * amount_due 3627 is -166 credit + 541 proration + 3252 next period). So
 * `invoice.amount_due` is NOT what an upgrade is charged today. The caller has
 * to split the lines: prorations are the amount due now, everything else is the
 * recurring amount. See src/app/api/billing/plan/preview/route.ts.
 */
export async function previewSubscriptionChange(input: {
  subscriptionId: string;
  items: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[];
  /**
   * Unix seconds. Pins the proration to a known instant instead of "whenever
   * Stripe evaluated this", which is what lets the caller tell the lines billed
   * at the change from the lines that belong to the next invoice. Stripe prorates
   * to the second, so without it the same request can price slightly differently
   * twice in a row.
   */
  prorationDate: number;
  automaticTax: boolean;
}): Promise<Stripe.Invoice> {
  const params: Stripe.InvoiceCreatePreviewParams = {
    subscription: input.subscriptionId,
    subscription_details: {
      items: input.items,
      proration_behavior: 'create_prorations',
      proration_date: input.prorationDate,
    },
  };

  // Passed only behind the flag, same as Checkout: without an active Stripe Tax
  // registration Stripe silently calculates nothing and returns no error, which
  // would quote a tax-free total against a taxed charge.
  if (input.automaticTax) {
    params.automatic_tax = { enabled: true };
  }

  return getStripe().invoices.createPreview(params);
}
