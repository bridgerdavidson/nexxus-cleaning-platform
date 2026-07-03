import { describe, it, expect } from 'vitest';
import { operatorBookingParams } from './useOpenOperatorBooking';

describe('operatorBookingParams', () => {
  it('sets newbooking=1', () => {
    expect(operatorBookingParams()).toEqual({ newbooking: '1' });
  });
});
