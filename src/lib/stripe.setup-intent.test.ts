import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * Locks the ACH SetupIntent contract for `createSetupIntent` in lib/stripe.ts (the helper used by
 * the homeowner + org self-pay "Add card" routes).
 *
 * Regression guard: when ACH is on we must request ONLY the Financial Connections `payment_method`
 * permission. Requesting `balances` hard-rejects every SetupIntent on a live Stripe account not
 * registered for the FC `balances` product, which previously broke ALL card-adding in prod
 * (see todo/enable-ach-payments-prod.md). We never read FC balances.
 *
 * `createSetupIntent` calls the same-module `getStripe()`, which a `vi.mock('@/lib/stripe')` can't
 * intercept (the internal call binds to the real export). So we mock the `stripe` package itself —
 * `getStripe()` lazily news up the (mocked) client — and drive the flags through env.
 */
const setupIntentsCreate = vi.fn(
  async (params: Stripe.SetupIntentCreateParams) => ({
    id: 'seti_1',
    object: 'setup_intent',
    client_secret: 'seti_1_secret',
    ...params,
  }),
);

vi.mock('stripe', () => ({
  default: class {
    setupIntents = { create: setupIntentsCreate };
  },
}));

import { createSetupIntent } from '@/lib/stripe';

describe('createSetupIntent (lib/stripe.ts) — ACH SetupIntent permissions', () => {
  const original = {
    enabled: process.env.STRIPE_ENABLED,
    ach: process.env.STRIPE_ACH_ENABLED,
    key: process.env.STRIPE_SECRET_KEY,
  };

  beforeEach(() => {
    setupIntentsCreate.mockClear();
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  });

  afterEach(() => {
    process.env.STRIPE_ENABLED = original.enabled;
    process.env.STRIPE_ACH_ENABLED = original.ach;
    process.env.STRIPE_SECRET_KEY = original.key;
  });

  it('offers card + bank and requests ONLY payment_method (no balances) when ACH is on', async () => {
    process.env.STRIPE_ACH_ENABLED = 'true';

    await createSetupIntent('cus_x');

    expect(setupIntentsCreate).toHaveBeenCalledTimes(1);
    const [params] = setupIntentsCreate.mock.calls[0];
    expect(params.payment_method_types).toEqual(['card', 'us_bank_account']);

    const permissions =
      params.payment_method_options?.us_bank_account?.financial_connections?.permissions;
    expect(permissions).toEqual(['payment_method']);
    expect(permissions).not.toContain('balances');
  });

  it('is card-only with no payment_method_options when ACH is off (unchanged behavior)', async () => {
    process.env.STRIPE_ACH_ENABLED = 'false';

    await createSetupIntent('cus_x');

    const [params] = setupIntentsCreate.mock.calls[0];
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.payment_method_options).toBeUndefined();
  });
});
