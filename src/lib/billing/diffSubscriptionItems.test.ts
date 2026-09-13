import { describe, expect, it } from 'vitest';
import { diffSubscriptionItems, type CurrentSubscriptionItems } from './diffSubscriptionItems';

const prices = {
  starter_monthly: 'p_sm', starter_annual: 'p_sa',
  growth_monthly: 'p_gm', growth_annual: 'p_ga',
  pro_monthly: 'p_pm', pro_annual: 'p_pa',
  extra_seat_monthly: 'p_esm', extra_seat_annual: 'p_esa',
} as const;

const current = (over: Partial<CurrentSubscriptionItems> = {}): CurrentSubscriptionItems => ({
  baseItemId: 'si_base',
  basePriceLookupKey: 'starter_monthly',
  seatItemId: null,
  seatQuantity: 0,
  ...over,
});

describe('diffSubscriptionItems', () => {
  it('swaps the base price on a tier upgrade with no extra seats', () => {
    expect(diffSubscriptionItems(current(), { tier: 'growth', period: 'monthly', seatCount: 8 }, prices))
      .toEqual([{ id: 'si_base', price: 'p_gm' }]);
  });

  it('adds a seat item when extras appear for the first time', () => {
    expect(diffSubscriptionItems(current(), { tier: 'starter', period: 'monthly', seatCount: 5 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { price: 'p_esm', quantity: 2 },
      ]);
  });

  it('updates an existing seat item', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 2 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'monthly', seatCount: 4 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { id: 'si_seat', price: 'p_esm', quantity: 1 },
      ]);
  });

  it('deletes the seat item when extras fall to zero', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 2 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'monthly', seatCount: 3 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { id: 'si_seat', deleted: true },
      ]);
  });

  it('omits the seat item entirely when there are no extras and none exists', () => {
    expect(diffSubscriptionItems(current(), { tier: 'starter', period: 'monthly', seatCount: 3 }, prices))
      .toEqual([{ id: 'si_base', price: 'p_sm' }]);
  });

  it('swaps both prices on a monthly to annual switch', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 2 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'annual', seatCount: 5 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sa' },
        { id: 'si_seat', price: 'p_esa', quantity: 2 },
      ]);
  });

  it('handles a downgrade that both drops a tier and removes seats', () => {
    const c = current({ basePriceLookupKey: 'pro_annual', seatItemId: 'si_seat', seatQuantity: 10 });
    expect(diffSubscriptionItems(c, { tier: 'starter', period: 'monthly', seatCount: 3 }, prices))
      .toEqual([
        { id: 'si_base', price: 'p_sm' },
        { id: 'si_seat', deleted: true },
      ]);
  });

  it('never emits a zero quantity, which would leave an empty invoice line', () => {
    const c = current({ seatItemId: 'si_seat', seatQuantity: 4 });
    const items = diffSubscriptionItems(c, { tier: 'growth', period: 'monthly', seatCount: 8 }, prices);
    expect(items.some((i) => 'quantity' in i && i.quantity === 0)).toBe(false);
  });
});
