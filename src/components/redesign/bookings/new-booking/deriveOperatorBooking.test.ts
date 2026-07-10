import { describe, it, expect } from 'vitest';
import type { ServiceType } from '@/hooks/useServices';
import {
  addSlot,
  removeSlotAt,
  effectiveTotalUsd,
  canReview,
  canCreate,
} from './deriveOperatorBooking';
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
    expect(canReview(EMPTY_OPERATOR_BOOKING)).toBe(false);
    expect(canReview(filled())).toBe(true);
    expect(canReview(filled({ cleanerId: null }))).toBe(false);
    expect(canReview(filled({ slots: [] }))).toBe(false);
  });
  it('does not require a customer for self-pay (org-owned)', () => {
    expect(canReview(filled({ billTo: 'self_pay', customerId: null }))).toBe(true);
  });
});

describe('canCreate', () => {
  it('customer-billed is creatable once reviewable (payment can defer)', () => {
    expect(canCreate(filled())).toBe(true);
  });
  it('self-pay needs an org method on file', () => {
    expect(canCreate(filled({ billTo: 'self_pay', customerId: null }))).toBe(false);
    expect(canCreate(filled({ billTo: 'self_pay', customerId: null, selfPayHasMethod: true }))).toBe(true);
  });
});
