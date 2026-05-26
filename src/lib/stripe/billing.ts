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

export async function createStripeSubscription(params: {
  customerId: string;
  priceId: string;
  organizationId: string;
}): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: params.priceId }],
    // Create the subscription incomplete so the first invoice's PaymentIntent can be confirmed
    // client-side; the card becomes the default payment method on success.
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: { organization_id: params.organizationId },
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
