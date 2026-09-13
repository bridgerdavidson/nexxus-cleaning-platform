import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const configurationsList = vi.fn();

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    prices: { list },
    billingPortal: { configurations: { list: configurationsList } },
  }),
}));

import { __resetBillingCaches, resolvePortalConfiguration, resolvePrices } from './billing';

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
