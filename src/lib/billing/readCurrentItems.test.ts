import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';

import { lookupKeyForItem, readCurrentItems } from './readCurrentItems';

type PriceShape = {
  lookup_key?: string | null;
  metadata?: Record<string, string>;
  product?: string | { metadata?: Record<string, string>; deleted?: boolean };
  recurring?: { interval: string } | null;
};

const item = (id: string, price: PriceShape | null, quantity = 1) =>
  ({ id, price, quantity }) as unknown as Stripe.SubscriptionItem;

const sub = (items: Stripe.SubscriptionItem[]) =>
  ({ id: 'sub_1', items: { data: items } }) as unknown as Stripe.Subscription;

describe('lookupKeyForItem', () => {
  it('reads the lookup key when the Price still carries one', () => {
    expect(lookupKeyForItem(item('si_1', { lookup_key: 'growth_monthly' }))).toBe('growth_monthly');
  });

  // transfer_lookup_key: true MOVES the key onto the new Price. Every existing
  // subscriber is left on a Price with no lookup key at all.
  it('falls back to the metadata the setup script stamps, which a transfer cannot move', () => {
    expect(
      lookupKeyForItem(
        item('si_1', { lookup_key: null, metadata: { nexxus_lookup_key: 'pro_annual' } }),
      ),
    ).toBe('pro_annual');
  });

  it('prefers the lookup key over the metadata when both are present', () => {
    expect(
      lookupKeyForItem(
        item('si_1', {
          lookup_key: 'starter_monthly',
          metadata: { nexxus_lookup_key: 'pro_annual' },
        }),
      ),
    ).toBe('starter_monthly');
  });

  it('composes the key from an expanded Product plus the billing interval', () => {
    expect(
      lookupKeyForItem(
        item('si_1', {
          lookup_key: null,
          product: { metadata: { nexxus_plan: 'growth' } },
          recurring: { interval: 'year' },
        }),
      ),
    ).toBe('growth_annual');
  });

  it('composes the seat key from the seat Product', () => {
    expect(
      lookupKeyForItem(
        item('si_1', {
          lookup_key: null,
          product: { metadata: { nexxus_plan: 'extra_seat' } },
          recurring: { interval: 'month' },
        }),
      ),
    ).toBe('extra_seat_monthly');
  });

  it('cannot classify an unexpanded product id, and says so rather than guessing', () => {
    expect(
      lookupKeyForItem(
        item('si_1', { lookup_key: null, product: 'prod_123', recurring: { interval: 'month' } }),
      ),
    ).toBe('');
  });

  it.each([
    ['a foreign lookup key', { lookup_key: 'legacy_grandfathered_plan' }],
    ['foreign metadata', { lookup_key: null, metadata: { nexxus_lookup_key: 'nope_weekly' } }],
    ['an unsupported interval', {
      lookup_key: null,
      product: { metadata: { nexxus_plan: 'growth' } },
      recurring: { interval: 'week' },
    }],
    ['no price at all', null],
  ])('returns empty for %s', (_label, price) => {
    expect(lookupKeyForItem(item('si_1', price as PriceShape | null))).toBe('');
  });
});

describe('readCurrentItems', () => {
  it('splits the base line from the seat line', () => {
    const current = readCurrentItems(
      sub([
        item('si_base', { lookup_key: 'growth_annual' }),
        item('si_seat', { lookup_key: 'extra_seat_annual' }, 4),
      ]),
    );
    expect(current).toEqual({
      baseItemId: 'si_base',
      basePriceLookupKey: 'growth_annual',
      seatItemId: 'si_seat',
      seatQuantity: 4,
    });
  });

  it('still recognises a plan line whose lookup key was transferred away', () => {
    const transferred = sub([
      item('si_base', { lookup_key: null, metadata: { nexxus_lookup_key: 'growth_monthly' } }),
    ]);
    expect(() => readCurrentItems(transferred)).not.toThrow();
    expect(readCurrentItems(transferred).basePriceLookupKey).toBe('growth_monthly');
  });

  it('reports no seat line as quantity zero rather than inventing one', () => {
    const current = readCurrentItems(sub([item('si_base', { lookup_key: 'starter_monthly' })]));
    expect(current.seatItemId).toBeNull();
    expect(current.seatQuantity).toBe(0);
  });

  // Diffing a subscription this system did not create would replace a price we
  // do not understand, so it refuses instead.
  it('throws when no line is ours', () => {
    expect(() => readCurrentItems(sub([item('si_x', { lookup_key: 'legacy_thing' })]))).toThrow(
      /no plan line we recognize/i,
    );
  });

  it('throws on a subscription with no items', () => {
    expect(() => readCurrentItems(sub([]))).toThrow(/no plan line we recognize/i);
  });
});
