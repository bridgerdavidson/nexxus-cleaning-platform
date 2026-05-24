/**
 * SetupIntent helpers for saving a card off-session (used by the hosted "card link"
 * page and the homeowner self-request flow). Confirmation happens client-side via
 * Stripe Elements / Payment Element; we only create + retrieve here.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

export async function createCardSetupIntent(
  customerId: string,
  metadata: Record<string, string>,
): Promise<Stripe.SetupIntent> {
  const stripe = getStripe();
  return stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
    metadata: { source: 'nexxus-cleaning-platform', ...metadata },
  });
}

export async function retrieveSetupIntent(setupIntentId: string): Promise<Stripe.SetupIntent> {
  const stripe = getStripe();
  return stripe.setupIntents.retrieve(setupIntentId);
}
