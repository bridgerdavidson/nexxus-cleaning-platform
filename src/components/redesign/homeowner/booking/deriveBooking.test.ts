import { describe, it, expect } from 'vitest';
import {
  addSlot,
  removeSlotAt,
  canReview,
  canSend,
  slotOrdinal,
  formatSlotLabel,
  bookingTotal,
} from './deriveBooking';
import { EMPTY_BOOKING, type BookingState } from './booking-types';

const filled = (over: Partial<BookingState> = {}): BookingState => ({
  ...EMPTY_BOOKING,
  propertyId: 'p',
  serviceTypeId: 's',
  slots: [{ date: '2026-07-05', time: '10:00' }],
  ...over,
});

describe('slots', () => {
  it('adds up to 3 and no more', () => {
    let s = [{ date: '2026-07-05', time: '10:00' }];
    s = addSlot(s, { date: '2026-07-06', time: '11:00' });
    s = addSlot(s, { date: '2026-07-07', time: '12:00' });
    expect(s).toHaveLength(3);
    expect(addSlot(s, { date: '2026-07-08', time: '13:00' })).toHaveLength(3);
  });
  it('removes by index', () => {
    expect(removeSlotAt([{ date: 'a', time: '1' }, { date: 'b', time: '2' }], 0)).toEqual([
      { date: 'b', time: '2' },
    ]);
  });
});

describe('gating', () => {
  it('canReview needs property + service + >=1 slot', () => {
    expect(canReview(EMPTY_BOOKING)).toBe(false);
    expect(canReview(filled())).toBe(true);
    expect(canReview(filled({ slots: [] }))).toBe(false);
  });
  it('canSend honors the payment requirement', () => {
    expect(canSend(filled(), false)).toBe(true);
    expect(canSend(filled(), true)).toBe(false);
    expect(canSend(filled({ paymentMethodId: 'pm_1' }), true)).toBe(true);
  });
});

describe('labels + total', () => {
  it('slotOrdinal', () => {
    expect(slotOrdinal(0)).toBe('1st');
    expect(slotOrdinal(2)).toBe('3rd');
  });
  it('formatSlotLabel', () => {
    const l = formatSlotLabel({ date: '2026-07-05', time: '10:00' });
    expect(l).toContain('Jul 5');
    expect(l).toMatch(/10:00\s?AM/i);
  });
  it('bookingTotal grosses up the card fee', () => {
    const t = bookingTotal(100, 'card');
    expect(t.baseUsd).toBe(100);
    expect(t.totalUsd).toBeGreaterThan(100);
    expect(Math.round(t.feeUsd * 100)).toBe(Math.round((t.totalUsd - t.baseUsd) * 100));
  });
  it('bookingTotal caps the ACH fee', () => {
    const t = bookingTotal(1000, 'us_bank_account');
    expect(t.feeUsd).toBeLessThanOrEqual(5);
  });
});
