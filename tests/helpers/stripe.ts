import Stripe from 'stripe';

export interface StripeFakeTransferCall {
  amount: number;
  destinationAccountId: string;
  sourceChargeId: string;
  appointmentId: string;
  idempotencyKey: string;
}

export interface StripeFake {
  transferCalls: StripeFakeTransferCall[];
  reset(): void;
}

/**
 * Sign a JSON payload with Stripe's real SDK helper so the route's
 * `constructWebhookEvent` accepts it. No network calls.
 *
 * The actual mock of `@/lib/stripe` lives in `tests/setup/integration.setup.ts`
 * because `vi.mock` only behaves correctly at module top-level (it's
 * statically hoisted by vitest's transformer).
 */
export function signWebhookPayload(payload: string, secret?: string): string {
  const stripe = new Stripe('sk_test_fake_for_signing', {
    apiVersion: '2025-12-15.clover' as Stripe.LatestApiVersion,
  });
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: secret ?? process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_fake_for_tests',
  });
}
