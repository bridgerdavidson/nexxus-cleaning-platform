import { describe, expect, it } from 'vitest';
import { operatorBookingParams } from './useOpenOperatorBooking';

describe('operatorBookingParams', () => {
  it('sets newbooking=1 with no prefill', () => {
    expect(operatorBookingParams()).toEqual({ newbooking: '1' });
  });
  it('adds date and time when prefilled', () => {
    expect(operatorBookingParams({ date: '2026-07-10', time: '13:00' })).toEqual({
      newbooking: '1', date: '2026-07-10', time: '13:00',
    });
  });
  it('omits empty prefill fields', () => {
    expect(operatorBookingParams({ date: '2026-07-10' })).toEqual({ newbooking: '1', date: '2026-07-10' });
  });
});
