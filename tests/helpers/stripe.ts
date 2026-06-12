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
  paymentIntentCalls: Array<{
    customerId: string;
    amount: number;
    appointmentId: string;
    paymentMethodId?: string;
  }>;
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

/** Magic payment-method ids `fakeOffSessionCharge` understands (Stripe-test-card spirit). */
export const MAGIC_PM = {
  /** Off-session charge throws a card_declined error (payment_intent attached, like the SDK). */
  decline: 'pm_decline',
  /** Off-session charge comes back `requires_action` (3-D Secure challenge, no one present). */
  threeDS: 'pm_3ds',
  /** Charge comes back `processing` (an ACH debit clearing over days). */
  bank: 'pm_bank',
} as const;

/**
 * Shape of the error Stripe's SDK throws on an off-session decline: the orchestration reads
 * `err.payment_intent.{id,status}` to persist the failed attempt, so the fake must carry it.
 */
export class FakeStripeCardError extends Error {
  type = 'StripeCardError';
  code = 'card_declined';
  payment_intent: { id: string; status: string };

  constructor(appointmentId: string) {
    super('Your card was declined.');
    this.name = 'StripeCardError';
    this.payment_intent = {
      id: `pi_declined_${appointmentId}`,
      status: 'requires_payment_method',
    };
  }
}

/**
 * Charge-primitive fake that models off-session outcomes by MAGIC payment-method id
 * (succeeds for anything else). Drop it into a per-file mock of a charge primitive:
 *
 *   vi.mock('@/lib/stripe/charges/charge', async () => {
 *     const { fakeOffSessionCharge } = await import('../../tests/helpers/stripe');
 *     return { createDestinationCharge: vi.fn(fakeOffSessionCharge) };
 *   });
 *
 * (vi.mock factories are hoisted above imports, so the helper must be imported inside.)
 */
export async function fakeOffSessionCharge(p: {
  appointmentId: string;
  paymentMethodId: string;
}): Promise<{ id: string; status: string }> {
  switch (p.paymentMethodId) {
    case MAGIC_PM.decline:
      throw new FakeStripeCardError(p.appointmentId);
    case MAGIC_PM.threeDS:
      return { id: `pi_3ds_${p.appointmentId}`, status: 'requires_action' };
    case MAGIC_PM.bank:
      return { id: `pi_bank_${p.appointmentId}`, status: 'processing' };
    default:
      return { id: `pi_test_${p.appointmentId}`, status: 'succeeded' };
  }
}
