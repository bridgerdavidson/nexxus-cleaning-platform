import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const configurationsList = vi.fn();
const portalSessionsCreate = vi.fn();
const sessionsCreate = vi.fn();
const subscriptionsUpdate = vi.fn();
const subscriptionsRetrieve = vi.fn();
const subscriptionsCancel = vi.fn();
const invoicesCreatePreview = vi.fn();

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    prices: { list },
    billingPortal: {
      configurations: { list: configurationsList },
      sessions: { create: portalSessionsCreate },
    },
    checkout: { sessions: { create: sessionsCreate } },
    invoices: { createPreview: invoicesCreatePreview },
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
  createBillingPortalSession,
  pauseSubscription,
  previewSubscriptionChange,
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

  const bothTagged = () => ({
    data: [
      { id: 'bpc_other', metadata: {} },
      { id: 'bpc_owner', metadata: { nexxus_portal: 'default' } },
      { id: 'bpc_admin', metadata: { nexxus_portal: 'remediation' } },
    ],
  });

  // Mutation target (ruling R24): "resolve the default configuration whatever
  // the variant". That hands an admin sent to fix a card the owner portal, with
  // its Cancel subscription button.
  it('resolves each variant to its own configuration', async () => {
    configurationsList.mockResolvedValue(bothTagged());
    expect(await resolvePortalConfiguration('default')).toBe('bpc_owner');
    expect(await resolvePortalConfiguration('remediation')).toBe('bpc_admin');
  });

  it('caches per variant, so one variant cannot answer for the other', async () => {
    configurationsList.mockResolvedValue(bothTagged());
    await resolvePortalConfiguration('default');
    await resolvePortalConfiguration('default');
    expect(configurationsList).toHaveBeenCalledTimes(1);

    // A warmed cache for one variant must not short-circuit the other.
    expect(await resolvePortalConfiguration('remediation')).toBe('bpc_admin');
    expect(configurationsList).toHaveBeenCalledTimes(2);
    await resolvePortalConfiguration('remediation');
    expect(configurationsList).toHaveBeenCalledTimes(2);
  });

  // Fails the way resolvePrices does: name the missing tag, point at the script.
  it('throws naming the missing tag, for either variant', async () => {
    configurationsList.mockResolvedValue({ data: [{ id: 'bpc_other', metadata: {} }] });
    await expect(resolvePortalConfiguration('default')).rejects.toThrow(/nexxus_portal=default/);
    await expect(resolvePortalConfiguration('default')).rejects.toThrow(/stripe-billing-setup/);
    await expect(resolvePortalConfiguration('remediation')).rejects.toThrow(
      /nexxus_portal=remediation/,
    );
    await expect(resolvePortalConfiguration('remediation')).rejects.toThrow(/stripe-billing-setup/);
  });

  // An account set up before R24 has the owner portal and not the admin one.
  // Half-configured must fail loudly rather than fall back to the one that can
  // cancel, so the operator runs the script instead of shipping the hole.
  it('never falls back to the other variant when only one is configured', async () => {
    configurationsList.mockResolvedValue({
      data: [{ id: 'bpc_owner', metadata: { nexxus_portal: 'default' } }],
    });
    await expect(resolvePortalConfiguration('remediation')).rejects.toThrow(
      /nexxus_portal=remediation/,
    );
  });

  it('does not cache a failure', async () => {
    configurationsList.mockResolvedValueOnce({ data: [] });
    await expect(resolvePortalConfiguration('remediation')).rejects.toThrow();
    configurationsList.mockResolvedValueOnce(bothTagged());
    expect(await resolvePortalConfiguration('remediation')).toBe('bpc_admin');
  });
});

describe('createBillingPortalSession payload', () => {
  beforeEach(() => {
    portalSessionsCreate.mockReset().mockResolvedValue({ url: 'https://billing.stripe.test/s' });
  });

  // Without this the portal falls back to the Stripe account default, where plan
  // changes are not disabled and the cancellation survey is not enabled.
  it('sends the configuration it is given', async () => {
    await createBillingPortalSession({
      customerId: 'cus_1',
      returnUrl: 'https://app.test/admin',
      configuration: 'bpc_ours',
    });
    expect(portalSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://app.test/admin',
      configuration: 'bpc_ours',
    });
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
  const items = [{ id: 'si_base', price: 'p_gm' }];
  const updatedParams = () => subscriptionsUpdate.mock.calls[0][1] as Record<string, unknown>;

  beforeEach(() => {
    subscriptionsUpdate.mockReset();
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_1', status: 'active' });
  });

  // create_prorations writes the proration LINES but never invoices them, so an
  // upgrade's extra money would wait for the next scheduled invoice: one month
  // late on monthly, up to a year late on annual.
  it('invoices an upgrade immediately and fails closed on a declined card', async () => {
    await updateSubscriptionItems('sub_1', items, 'org-1', { invoiceNow: true });
    const [id, params] = subscriptionsUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('sub_1');
    expect(params.proration_behavior).toBe('always_invoice');
    expect(params.payment_behavior).toBe('error_if_incomplete');
  });

  it('defers a downgrade to the next invoice and never charges now', async () => {
    await updateSubscriptionItems('sub_1', items, 'org-1', { invoiceNow: false });
    const params = updatedParams();
    expect(params.proration_behavior).toBe('create_prorations');
    // Present-and-undefined would still be sent as a key; it must be absent.
    expect('payment_behavior' in params).toBe(false);
  });

  it('sends the items and the org tag either way', async () => {
    await updateSubscriptionItems('sub_1', items, 'org-1', { invoiceNow: false });
    expect(updatedParams().items).toEqual([{ id: 'si_base', price: 'p_gm' }]);
    expect(updatedParams().metadata).toEqual({ organization_id: 'org-1' });
  });

  it('never pins payment_method_types on the update either', async () => {
    await updateSubscriptionItems('sub_1', items, 'org-1', { invoiceNow: true });
    expect('payment_method_types' in updatedParams()).toBe(false);
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

// ---------------------------------------------------------------------------
// Preview. The route mocks this module, so these are the only tests that see
// the parameters, and each one is a decision the customer feels: a missing
// automatic_tax quotes a total the Stripe page then exceeds, and a missing
// proration_date lets the same request price differently twice in a row.
// ---------------------------------------------------------------------------

describe('previewSubscriptionChange payload', () => {
  const items = [{ id: 'si_base', price: 'p_gm' }];

  beforeEach(() => {
    invoicesCreatePreview.mockReset();
    invoicesCreatePreview.mockResolvedValue({ id: 'in_preview', amount_due: 3780 });
  });

  const params = () => invoicesCreatePreview.mock.calls[0][0] as Record<string, unknown>;
  const subDetails = () =>
    params().subscription_details as Record<string, unknown>;

  it('previews the subscription with the diffed items and a pinned proration date', async () => {
    await previewSubscriptionChange({
      subscriptionId: 'sub_1',
      items,
      prorationDate: 1_700_000_000,
      automaticTax: false,
    });
    expect(params().subscription).toBe('sub_1');
    expect(subDetails().items).toEqual(items);
    expect(subDetails().proration_date).toBe(1_700_000_000);
  });

  // always_invoice would not isolate the immediate charge anyway: the preview
  // returns the UPCOMING invoice either way, and the route splits its lines.
  it('always prorates with create_prorations', async () => {
    await previewSubscriptionChange({
      subscriptionId: 'sub_1',
      items,
      prorationDate: 1,
      automaticTax: false,
    });
    expect(subDetails().proration_behavior).toBe('create_prorations');
  });

  it('asks for tax only when the caller says the flag is on', async () => {
    await previewSubscriptionChange({
      subscriptionId: 'sub_1',
      items,
      prorationDate: 1,
      automaticTax: true,
    });
    expect(params().automatic_tax).toEqual({ enabled: true });
  });

  it('omits automatic_tax entirely when the flag is off, rather than sending false', async () => {
    await previewSubscriptionChange({
      subscriptionId: 'sub_1',
      items,
      prorationDate: 1,
      automaticTax: false,
    });
    expect('automatic_tax' in params()).toBe(false);
  });

  // subscription already identifies the customer; readLiveSubscription has no
  // customer id to give, and passing a wrong one would price someone else.
  it('never passes a customer', async () => {
    await previewSubscriptionChange({
      subscriptionId: 'sub_1',
      items,
      prorationDate: 1,
      automaticTax: true,
    });
    expect('customer' in params()).toBe(false);
  });

  it('creates no invoice and updates no subscription', async () => {
    subscriptionsUpdate.mockReset();
    await previewSubscriptionChange({
      subscriptionId: 'sub_1',
      items,
      prorationDate: 1,
      automaticTax: true,
    });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
    expect(invoicesCreatePreview).toHaveBeenCalledTimes(1);
  });
});
