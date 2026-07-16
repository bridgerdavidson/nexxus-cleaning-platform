import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * Locks the ACH SetupIntent contract for `createCardSetupIntent`.
 *
 * Regression guard: when ACH is on we must request ONLY the Financial Connections
 * `payment_method` permission. Adding `balances` hard-rejects every SetupIntent on a live
 * Stripe account not registered for the FC `balances` product, which previously broke ALL
 * card-adding in prod (see todo/enable-ach-payments-prod.md). We never read FC balances.
 */
// The generic carries the (params, opts) tuple type so `mock.calls[0]` destructures
// both the create params and the per-request options (idempotency key) below.
const setupIntentsCreate = vi.fn<
  (params: Stripe.SetupIntentCreateParams, opts?: Stripe.RequestOptions) => Promise<Record<string, unknown>>
>(async (params) => ({
  id: 'seti_card_1',
  object: 'setup_intent',
  client_secret: 'seti_card_1_secret',
  ...params,
}));
const achEnabledMock = vi.fn(() => true);

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ setupIntents: { create: setupIntentsCreate } }),
}));
vi.mock('@/lib/stripe/flags', () => ({ stripeAchEnabled: () => achEnabledMock() }));

import { createCardSetupIntent } from './setup-intents';

describe('createCardSetupIntent — ACH SetupIntent permissions', () => {
  beforeEach(() => {
    setupIntentsCreate.mockClear();
    achEnabledMock.mockReturnValue(true);
  });

  it('offers card + bank and requests ONLY payment_method (no balances) when ACH is on', async () => {
    await createCardSetupIntent('cus_x', {});

    expect(setupIntentsCreate).toHaveBeenCalledTimes(1);
    const [params] = setupIntentsCreate.mock.calls[0];
    expect(params.payment_method_types).toEqual(['card', 'us_bank_account']);

    const permissions =
      params.payment_method_options?.us_bank_account?.financial_connections?.permissions;
    expect(permissions).toEqual(['payment_method']);
    expect(permissions).not.toContain('balances');
  });

  it('is card-only with no payment_method_options when ACH is off (unchanged behavior)', async () => {
    achEnabledMock.mockReturnValue(false);

    await createCardSetupIntent('cus_x', {});

    const [params] = setupIntentsCreate.mock.calls[0];
    expect(params.payment_method_types).toEqual(['card']);
    expect(params.payment_method_options).toBeUndefined();
  });

  it('keys on the card-link token for idempotency when one is present', async () => {
    await createCardSetupIntent('cus_x', { token: 'tok_123' });

    const [, opts] = setupIntentsCreate.mock.calls[0];
    expect(opts).toEqual({ idempotencyKey: 'setup-tok_123' });
  });
});
