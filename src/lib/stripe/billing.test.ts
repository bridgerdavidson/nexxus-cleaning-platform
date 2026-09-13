import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const configurationsList = vi.fn();
const sessionsCreate = vi.fn();
const subscriptionsUpdate = vi.fn();
const subscriptionsRetrieve = vi.fn();
const subscriptionsCancel = vi.fn();

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    prices: { list },
    billingPortal: { configurations: { list: configurationsList } },
    checkout: { sessions: { create: sessionsCreate } },
    subscriptions: {
      update: subscriptionsUpdate,
      retrieve: subscriptionsRetrieve,
      cancel: subscriptionsCancel,
    },
  }),
}));

import {
  __resetBillingCaches,
  cancelStripeSubscription,
  cancelSubscriptionAtPeriodEnd,
  createBillingCheckoutSession,
  pauseSubscription,
  resolvePortalConfiguration,
  resolvePrices,
  resumeSubscription,
  retrieveSubscription,
  updateSubscriptionItems,
  type BillingCheckoutInput,
} from './billing';

const allEight = () => ({
  data: [
    'starter_monthly', 'starter_annual', 'growth_monthly', 'growth_annual',
    'pro_monthly', 'pro_annual', 'extra_seat_monthly', 'extra_seat_annual',
  ].map((lookup_key, i) => ({ id: `price_${i}`, lookup_key })),
});

describe('resolvePrices', () => {
  beforeEach(() => { __resetBillingCaches(); list.mockReset(); });

  it('maps every lookup key to its price id', async () => {
    list.mockResolvedValue(allEight());
    const prices = await resolvePrices();
    expect(prices.starter_monthly).toBe('price_0');
    expect(prices.extra_seat_annual).toBe('price_7');
  });

  it('asks Stripe once and caches', async () => {
    list.mockResolvedValue(allEight());
    await resolvePrices();
    await resolvePrices();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('throws naming the missing keys', async () => {
    list.mockResolvedValue({ data: [{ id: 'price_0', lookup_key: 'starter_monthly' }] });
    await expect(resolvePrices()).rejects.toThrow(/extra_seat_annual/);
    await expect(resolvePrices()).rejects.toThrow(/pro_monthly/);
  });

  it('does not cache a failure', async () => {
    list.mockResolvedValueOnce({ data: [] });
    await expect(resolvePrices()).rejects.toThrow();
    list.mockResolvedValueOnce(allEight());
    await expect(resolvePrices()).resolves.toBeTruthy();
  });

  it('requests only active prices', async () => {
    list.mockResolvedValue(allEight());
    await resolvePrices();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });
});

describe('resolvePortalConfiguration', () => {
  beforeEach(() => { __resetBillingCaches(); configurationsList.mockReset(); });

  it('picks the one tagged default', async () => {
    configurationsList.mockResolvedValue({
      data: [
        { id: 'bpc_other', metadata: {} },
        { id: 'bpc_ours', metadata: { nexxus_portal: 'default' } },
      ],
    });
    expect(await resolvePortalConfiguration()).toBe('bpc_ours');
  });

  it('throws when none is tagged', async () => {
    configurationsList.mockResolvedValue({ data: [{ id: 'bpc_other', metadata: {} }] });
    await expect(resolvePortalConfiguration()).rejects.toThrow(/stripe-billing-setup/);
  });
});

// ---------------------------------------------------------------------------
// Payload-level coverage. The route specs mock this whole module, so these are
// the ONLY tests that see what actually goes to Stripe. Every constraint below
// is a deliberate design decision that is invisible one layer up.
// ---------------------------------------------------------------------------

const checkoutInput = (overrides: Partial<BillingCheckoutInput> = {}): BillingCheckoutInput => ({
  customerId: 'cus_test',
  lineItems: [{ price: 'p_sm', quantity: 1 }],
  organizationId: 'org-1',
  successUrl: 'https://app.test/ok',
  cancelUrl: 'https://app.test/no',
  automaticTax: false,
  ...overrides,
});

const createdParams = () => sessionsCreate.mock.calls[0][0] as Record<string, unknown>;

describe('createBillingCheckoutSession payload', () => {
  beforeEach(() => {
    sessionsCreate.mockReset();
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.test/s' });
  });

  it('collects a billing address from day one, so the data exists when Stripe Tax is switched on', async () => {
    await createBillingCheckoutSession(checkoutInput());
    expect(createdParams().billing_address_collection).toBe('required');
    expect(createdParams().customer_update).toEqual({ address: 'auto', name: 'auto' });
  });

  it('never pins payment_method_types, so Stripe picks eligible methods from Dashboard settings', async () => {
    await createBillingCheckoutSession(checkoutInput());
    expect('payment_method_types' in createdParams()).toBe(false);
  });

  it('never sends trial_period_days: the app owns the trial and it is over by checkout', async () => {
    await createBillingCheckoutSession(checkoutInput());
    const params = createdParams();
    expect('trial_period_days' in params).toBe(false);
    const subscriptionData = params.subscription_data as Record<string, unknown>;
    expect('trial_period_days' in subscriptionData).toBe(false);
    expect(JSON.stringify(params)).not.toContain('trial_period_days');
  });

  it('omits automatic_tax entirely when the caller has it off', async () => {
    await createBillingCheckoutSession(checkoutInput({ automaticTax: false }));
    expect('automatic_tax' in createdParams()).toBe(false);
  });

  it('sends automatic_tax only when the caller has it on', async () => {
    await createBillingCheckoutSession(checkoutInput({ automaticTax: true }));
    expect(createdParams().automatic_tax).toEqual({ enabled: true });
  });

  it('subscribes, tags the org on both the session and the subscription, and allows promo codes', async () => {
    await createBillingCheckoutSession(checkoutInput());
    const params = createdParams();
    expect(params.mode).toBe('subscription');
    expect(params.customer).toBe('cus_test');
    expect(params.metadata).toEqual({ organization_id: 'org-1' });
    expect(params.subscription_data).toEqual({ metadata: { organization_id: 'org-1' } });
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.success_url).toBe('https://app.test/ok');
    expect(params.cancel_url).toBe('https://app.test/no');
    expect(params.line_items).toEqual([{ price: 'p_sm', quantity: 1 }]);
  });

  it('omits integration_identifier, which the pinned API version does not accept', async () => {
    await createBillingCheckoutSession(checkoutInput());
    expect('integration_identifier' in createdParams()).toBe(false);
  });
});

describe('updateSubscriptionItems payload', () => {
  beforeEach(() => {
    subscriptionsUpdate.mockReset();
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_1', status: 'active' });
  });

  it('prorates immediately in both directions, which is what avoids Subscription Schedules', async () => {
    await updateSubscriptionItems('sub_1', [{ id: 'si_base', price: 'p_gm' }], 'org-1');
    const [id, params] = subscriptionsUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('sub_1');
    expect(params.proration_behavior).toBe('create_prorations');
    expect(params.items).toEqual([{ id: 'si_base', price: 'p_gm' }]);
    expect(params.metadata).toEqual({ organization_id: 'org-1' });
  });

  it('never pins payment_method_types on the update either', async () => {
    await updateSubscriptionItems('sub_1', [{ id: 'si_base', price: 'p_gm' }], 'org-1');
    const params = subscriptionsUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect('payment_method_types' in params).toBe(false);
  });
});

describe('retrieveSubscription', () => {
  it('asks for the subscription by id, with no extra expansion', async () => {
    subscriptionsRetrieve.mockReset();
    subscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', items: { data: [] } });
    await retrieveSubscription('sub_1');
    expect(subscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
  });
});

// ---------------------------------------------------------------------------
// Pause / resume / cancel payloads. Same reason as above: the orchestration
// layer mocks this module, so these are the only tests that see the real
// parameters, and every one of them is a decision that is invisible upstream.
// ---------------------------------------------------------------------------

describe('pauseSubscription payload', () => {
  beforeEach(() => {
    subscriptionsUpdate.mockReset();
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_1', status: 'active' });
  });

  it("voids invoices for the paused months rather than stacking drafts", async () => {
    await pauseSubscription('sub_1', 1893456000);
    const [id, params] = subscriptionsUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('sub_1');
    expect(params.pause_collection).toEqual({ behavior: 'void', resumes_at: 1893456000 });
  });

  it('omits resumes_at entirely for an open-ended pause', async () => {
    await pauseSubscription('sub_1', null);
    const params = subscriptionsUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(params.pause_collection).toEqual({ behavior: 'void' });
    expect('resumes_at' in (params.pause_collection as object)).toBe(false);
  });

  it('changes nothing else about the subscription', async () => {
    await pauseSubscription('sub_1', null);
    expect(Object.keys(subscriptionsUpdate.mock.calls[0][1] as object)).toEqual(['pause_collection']);
  });
});

describe('resumeSubscription payload', () => {
  beforeEach(() => {
    subscriptionsUpdate.mockReset();
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_1', status: 'active' });
  });

  it('clears the pause with an empty string, which is the only value Stripe accepts', async () => {
    await resumeSubscription('sub_1');
    const [id, params] = subscriptionsUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('sub_1');
    expect(params.pause_collection).toBe('');
    // null would not clear it and undefined would be dropped from the body,
    // leaving the customer paused while the app believed it had resumed them.
    expect(params.pause_collection).not.toBeNull();
    expect('pause_collection' in params).toBe(true);
  });
});

describe('cancel payloads', () => {
  beforeEach(() => {
    subscriptionsUpdate.mockReset();
    subscriptionsCancel.mockReset();
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_1', status: 'active' });
    subscriptionsCancel.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
  });

  it('period end schedules the cancel and does not end the subscription now', async () => {
    await cancelSubscriptionAtPeriodEnd('sub_1');
    const [id, params] = subscriptionsUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('sub_1');
    expect(params.cancel_at_period_end).toBe(true);
    expect(subscriptionsCancel).not.toHaveBeenCalled();
  });

  it('now ends the subscription and does not merely schedule it', async () => {
    await cancelStripeSubscription('sub_1');
    expect(subscriptionsCancel).toHaveBeenCalledWith('sub_1');
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });
});
