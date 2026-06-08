/**
 * SetupIntent helpers for saving a card off-session (used by the hosted "card link"
 * page and the homeowner self-request flow). Confirmation happens client-side via
 * Stripe Elements / Payment Element; we only create + retrieve here.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { stripeAchEnabled } from '@/lib/stripe/flags';

export async function createCardSetupIntent(
  customerId: string,
  metadata: Record<string, string>,
): Promise<Stripe.SetupIntent> {
  const stripe = getStripe();
  // ACH (us_bank_account) offered alongside card when enabled, with Financial Connections for
  // instant verification. The Payment Element renders the bank option from these allowed types.
  const ach = stripeAchEnabled();
  const params: Stripe.SetupIntentCreateParams = {
    customer: customerId,
    payment_method_types: ach ? ['card', 'us_bank_account'] : ['card'],
    usage: 'off_session',
    metadata: { source: 'nexxus-cleaning-platform', ...metadata },
  };
  if (ach) {
    params.payment_method_options = {
      us_bank_account: { financial_connections: { permissions: ['payment_method', 'balances'] } },
    };
  }
  // Idempotency: card-link SetupIntents carry a unique per-link token, so keying on it collapses a
  // double-submit (e.g. a re-clicked "Send card link") into one SetupIntent. Flows without a token
  // (homeowner self-request) are interactive one-offs and pass no key.
  const idempotencyKey = metadata.token ? `setup-${metadata.token}` : undefined;
  return stripe.setupIntents.create(params, idempotencyKey ? { idempotencyKey } : undefined);
}

export async function retrieveSetupIntent(setupIntentId: string): Promise<Stripe.SetupIntent> {
  const stripe = getStripe();
  return stripe.setupIntents.retrieve(setupIntentId);
}
