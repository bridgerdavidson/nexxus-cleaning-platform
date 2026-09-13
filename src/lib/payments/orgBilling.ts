/**
 * Org SaaS-subscription orchestration (Phase 5, Scenario 3). Pairs DB reads/writes on
 * `organizations` with the Stripe wrappers in `@/lib/stripe/billing`. Kept out of the routes
 * (and out of the webhook dispatcher) so the Stripe calls can be mocked while the DB
 * persistence runs against a real Supabase in integration tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createStripeBillingCustomer,
  createStripeSubscription,
  cancelStripeSubscription,
  createBillingPortalSession,
  createBillingCheckoutSession,
  resolvePrices,
} from '@/lib/stripe/billing';
import { requireAppUrl } from '@/lib/billing/appUrl';
import { billingTaxEnabled } from '@/lib/billing/flags';
import { PLANS, lookupKeyFor, seatLookupKeyFor } from '@/lib/billing/plans';
import type { PlanSelection } from '@/lib/billing/planSelection';

export type { OrgSubscriptionStatus } from '@/lib/billing/access';
import type { OrgSubscriptionStatus } from '@/lib/billing/access';

/**
 * Collapse any Stripe subscription status into one our
 * `organizations_subscription_status_chk` constraint allows
 * (none | trialing | active | past_due | unpaid | canceled). Unknown or initial
 * states map to a sensible allowed value so a webhook can never violate the
 * constraint.
 *
 * `past_due` and `unpaid` are deliberately NOT merged: past_due means Stripe is
 * still retrying and only shows a banner, unpaid means retries are exhausted and
 * the organization freezes. Stripe's own `paused` status is unrelated to this
 * app's paused state, which is derived from pause_collection, so it stays `none`.
 */
export function mapSubscriptionStatus(stripeStatus: string | null | undefined): OrgSubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    // 'incomplete', 'paused', null/undefined, or anything unrecognized → not yet active.
    default:
      return 'none';
  }
}

interface OrgBillingRow {
  id: string;
  name: string;
  billing_email: string | null;
  stripe_customer_id: string | null;
  subscription_id: string | null;
}

async function loadOrg(supabase: SupabaseClient, organizationId: string): Promise<OrgBillingRow | null> {
  const { data } = await supabase
    .from('organizations')
    .select('id, name, billing_email, stripe_customer_id, subscription_id')
    .eq('id', organizationId)
    .maybeSingle();
  return (data as OrgBillingRow | null) ?? null;
}

/** Reuse the org's billing Customer, or create + persist one. Throws if the org is missing. */
export async function getOrCreateOrgCustomer(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string> {
  const org = await loadOrg(supabase, organizationId);
  if (!org) throw new Error('organization_not_found');
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await createStripeBillingCustomer({
    organizationId,
    name: org.name,
    email: org.billing_email,
  });
  await supabase.from('organizations').update({ stripe_customer_id: customer.id }).eq('id', organizationId);
  return customer.id;
}

export interface StartSubscriptionResult {
  subscriptionId: string;
  status: string;
  customerId: string;
  /** First-invoice PaymentIntent client secret, if confirmation is needed. */
  clientSecret: string | null;
}

export async function startOrgSubscription(
  supabase: SupabaseClient,
  organizationId: string,
  priceId: string,
): Promise<StartSubscriptionResult> {
  const customerId = await getOrCreateOrgCustomer(supabase, organizationId);
  const sub = await createStripeSubscription({ customerId, priceId, organizationId });

  // Mirror immediately; the customer.subscription.* webhook is the backstop.
  await supabase
    .from('organizations')
    .update({ subscription_id: sub.id, subscription_status: mapSubscriptionStatus(sub.status) })
    .eq('id', organizationId);

  // Pull the PaymentIntent client secret off the expanded latest invoice, if present.
  let clientSecret: string | null = null;
  const invoice = sub.latest_invoice;
  if (invoice && typeof invoice !== 'string') {
    const pi = (invoice as { payment_intent?: unknown }).payment_intent;
    if (pi && typeof pi !== 'string') {
      clientSecret = (pi as { client_secret?: string | null }).client_secret ?? null;
    }
  }

  return { subscriptionId: sub.id, status: sub.status, customerId, clientSecret };
}

export async function getOrgPortalLink(
  supabase: SupabaseClient,
  organizationId: string,
  returnUrl: string,
): Promise<string> {
  const customerId = await getOrCreateOrgCustomer(supabase, organizationId);
  const session = await createBillingPortalSession({ customerId, returnUrl });
  return session.url;
}

/** Cancel the org's subscription immediately. The customer.subscription.deleted webhook mirrors state. */
export async function cancelOrgSubscription(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const org = await loadOrg(supabase, organizationId);
  if (!org?.subscription_id) return;
  await cancelStripeSubscription(org.subscription_id);
}

/**
 * Append an app-initiated row to the subscription timeline, so the back office
 * shows both what we did and what Stripe told us. stripe_event_id is unique and
 * not Stripe-validated, so app rows use an `app:` prefix.
 */
export async function appendBillingEvent(
  supabase: SupabaseClient,
  organizationId: string,
  eventType: `app.${string}`,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('tenant_subscription_events').insert({
    organization_id: organizationId,
    stripe_event_id: `app:${crypto.randomUUID()}`,
    event_type: eventType,
    payload,
  });
  // The timeline is forensic, not load-bearing: never fail a billing action
  // because its audit row did not land.
  if (error) console.error(`appendBillingEvent(${eventType}) failed:`, error.message);
}

export interface BillingCheckoutResult {
  sessionId: string;
  /** Stripe types this nullable; a subscription-mode session always has one. */
  checkoutUrl: string | null;
}

/**
 * Open a hosted Checkout Session for a plan selection.
 *
 * Shared by POST /api/billing/checkout and POST /api/billing/plan: the plan
 * route falls back to checkout when the org has no live subscription, so the
 * client has one entry point for "change my plan" and both paths necessarily
 * build the same line items and the same return URLs.
 */
export async function buildBillingCheckoutSession(
  supabase: SupabaseClient,
  organizationId: string,
  selection: PlanSelection,
): Promise<BillingCheckoutResult> {
  const prices = await resolvePrices();
  const extras = Math.max(0, selection.seatCount - PLANS[selection.tier].includedSeats);
  const lineItems = [
    { price: prices[lookupKeyFor(selection.tier, selection.period)], quantity: 1 },
    ...(extras > 0 ? [{ price: prices[seatLookupKeyFor(selection.period)], quantity: extras }] : []),
  ];

  const customerId = await getOrCreateOrgCustomer(supabase, organizationId);
  const appUrl = requireAppUrl();

  const session = await createBillingCheckoutSession({
    customerId,
    lineItems,
    organizationId,
    automaticTax: billingTaxEnabled(),
    successUrl: `${appUrl}/admin/settings?section=billing&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${appUrl}/admin/settings?section=billing&checkout=canceled`,
  });

  return { sessionId: session.id, checkoutUrl: session.url };
}
