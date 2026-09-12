import { describe, it, expect } from 'vitest';
import type { ServiceType } from '@/hooks/useServices';
import {
  addSlot,
  removeSlotAt,
  effectiveTotalUsd,
  canReview,
  canCreate,
  canCreateBooking,
  bookingPriceError,
  selfPayCleanerBlockReason,
} from './deriveOperatorBooking';
import { isCleanerPayable, type CleanerPayoutFields } from '@/lib/payments/isCleanerPayable';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';

const svc = { id: 's1', base_price: 150, duration_minutes: 120 } as ServiceType;

const filled = (over: Partial<OperatorBookingState> = {}): OperatorBookingState => ({
  ...EMPTY_OPERATOR_BOOKING,
  customerId: 'c1',
  propertyId: 'p1',
  serviceTypeId: 's1',
  checklistId: 'cl1',
  slots: [{ date: '2026-07-05', time: '10:00' }],
  cleanerId: 'cleaner1',
  ...over,
});

describe('slots', () => {
  it('adds up to 3 and no more', () => {
    let s = [{ date: 'a', time: '1' }];
    s = addSlot(s, { date: 'b', time: '2' });
    s = addSlot(s, { date: 'c', time: '3' });
    expect(s).toHaveLength(3);
    expect(addSlot(s, { date: 'd', time: '4' })).toHaveLength(3);
  });
  it('removes by index', () => {
    expect(removeSlotAt([{ date: 'a', time: '1' }, { date: 'b', time: '2' }], 0)).toEqual([
      { date: 'b', time: '2' },
    ]);
  });
});

describe('effectiveTotalUsd', () => {
  it('uses the base price by default', () => {
    expect(effectiveTotalUsd(filled(), svc)).toBe(150);
  });
  it('uses the override when set', () => {
    expect(effectiveTotalUsd(filled({ priceOverride: 175 }), svc)).toBe(175);
  });
  it('adds the checklist price adder when no override', () => {
    expect(effectiveTotalUsd(filled(), svc, { price_adder: 20 })).toBe(170);
  });
  it('ignores the checklist adder when an override is set', () => {
    expect(effectiveTotalUsd(filled({ priceOverride: 175 }), svc, { price_adder: 20 })).toBe(175);
  });
});

describe('canReview', () => {
  it('requires customer + property + service + checklist + a slot + cleaner (customer-billed)', () => {
    expect(canReview(EMPTY_OPERATOR_BOOKING, null)).toBe(false);
    expect(canReview(filled(), svc)).toBe(true);
    expect(canReview(filled({ cleanerId: null }), svc)).toBe(false);
    expect(canReview(filled({ slots: [] }), svc)).toBe(false);
  });
  it('does not require a customer for self-pay (org-owned)', () => {
    expect(canReview(filled({ billTo: 'self_pay', customerId: null }), svc)).toBe(true);
  });
});

describe('minimum job price gate ($1)', () => {
  const zeroSvc = { id: 's1', base_price: 0, duration_minutes: 60 } as ServiceType;

  it('blocks Review on a $0 service with no override (the pilot "Custom" job)', () => {
    expect(canReview(filled(), zeroSvc)).toBe(false);
    expect(canReview(filled({ billTo: 'self_pay', customerId: null }), zeroSvc)).toBe(false);
  });

  it('blocks Review when the override is under $1', () => {
    expect(canReview(filled({ priceOverride: 0 }), svc)).toBe(false);
    expect(canReview(filled({ priceOverride: 0.5 }), svc)).toBe(false);
  });

  it('allows exactly $1, from an override or from base + checklist adder', () => {
    expect(canReview(filled({ priceOverride: 1 }), zeroSvc)).toBe(true);
    expect(canReview(filled(), zeroSvc, { price_adder: 1 })).toBe(true);
  });

  it('blocks when the service has not loaded (no price to write)', () => {
    expect(canReview(filled(), null)).toBe(false);
  });

  it('blocks Create too, for one-time and recurring bookings', () => {
    const selfPayReady = filled({ billTo: 'self_pay', customerId: null, selfPayHasMethod: true });
    expect(canCreate(selfPayReady, zeroSvc)).toBe(false);
    expect(canCreateBooking(selfPayReady, 0, zeroSvc)).toBe(false);
    const recurring = filled({ recurrence: { ...EMPTY_OPERATOR_BOOKING.recurrence, enabled: true } });
    expect(canCreateBooking(recurring, 4, zeroSvc)).toBe(false);
    expect(canCreateBooking(recurring, 4, svc)).toBe(true);
  });

  it('bookingPriceError says nothing until a service is chosen, then names the rule', () => {
    expect(bookingPriceError(EMPTY_OPERATOR_BOOKING, null)).toBeNull();
    expect(bookingPriceError(filled(), zeroSvc)).toBe('Price must be at least $1.');
    expect(bookingPriceError(filled({ priceOverride: 20 }), zeroSvc)).toBeNull();
    expect(bookingPriceError(filled(), svc)).toBeNull();
  });
});

describe('canCreate', () => {
  it('customer-billed is creatable once reviewable (payment can defer)', () => {
    expect(canCreate(filled(), svc)).toBe(true);
  });
  it('self-pay needs an org method on file', () => {
    expect(canCreate(filled({ billTo: 'self_pay', customerId: null }), svc)).toBe(false);
    expect(canCreate(filled({ billTo: 'self_pay', customerId: null, selfPayHasMethod: true }), svc)).toBe(true);
  });
});

describe('selfPayCleanerBlockReason', () => {
  /** A payout-ready percentage cleaner; tests flip one field at a time. */
  const ready: CleanerPayoutFields = {
    payout_model: 'percentage',
    payout_percent: 80,
    flat_rate_cents: null,
    payout_configured_at: '2026-08-01T00:00:00Z',
    stripe_connect_account_id: 'acct_123',
    stripe_connect_onboarding_complete: true,
  };

  it('offers a flat-rate cleaner with Connect complete (percent is 0 in flat mode)', () => {
    expect(
      selfPayCleanerBlockReason({ ...ready, payout_model: 'flat', payout_percent: 0, flat_rate_cents: 12000 }),
    ).toBeNull();
  });

  it('offers a request-mode cleaner with Connect complete', () => {
    expect(selfPayCleanerBlockReason({ ...ready, payout_model: 'request', payout_percent: 0 })).toBeNull();
  });

  it('offers a percentage cleaner with Connect complete', () => {
    expect(selfPayCleanerBlockReason(ready)).toBeNull();
  });

  it('names the block reason so the row says what to fix', () => {
    expect(selfPayCleanerBlockReason({ ...ready, payout_configured_at: null })).toBe('Pay not set');
    expect(selfPayCleanerBlockReason({ ...ready, payout_model: 'hourly_external' })).toBe('Paid off platform');
    expect(
      selfPayCleanerBlockReason({
        ...ready,
        stripe_connect_account_id: null,
        stripe_connect_onboarding_complete: false,
      }),
    ).toBe('No Stripe payout account yet');
    expect(selfPayCleanerBlockReason({ ...ready, stripe_connect_onboarding_complete: false })).toBe(
      'Stripe payout setup not finished',
    );
    expect(
      selfPayCleanerBlockReason({ ...ready, payout_model: 'flat', payout_percent: 0, flat_rate_cents: null }),
    ).toBe('Flat rate not set');
    expect(selfPayCleanerBlockReason({ ...ready, payout_percent: 0 })).toBe('Pay set to 0%');
  });

  it('agrees with isCleanerPayable: blocked exactly when settlement would not pay', () => {
    const rows: CleanerPayoutFields[] = [
      ready,
      { ...ready, payout_model: 'flat', payout_percent: 0, flat_rate_cents: 5000 },
      { ...ready, payout_model: 'request', payout_percent: 0 },
      { ...ready, payout_configured_at: null },
      { ...ready, stripe_connect_onboarding_complete: false },
      { ...ready, stripe_connect_account_id: null },
      { ...ready, payout_model: 'hourly_external' },
      { ...ready, payout_model: 'flat', flat_rate_cents: 0 },
      { ...ready, payout_percent: '0' },
    ];
    for (const r of rows) {
      expect(selfPayCleanerBlockReason(r) === null, JSON.stringify(r)).toBe(isCleanerPayable(r));
    }
  });
});
