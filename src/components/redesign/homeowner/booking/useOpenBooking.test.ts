import { describe, it, expect } from 'vitest';
import { bookingParams } from './useOpenBooking';

describe('bookingParams', () => {
  it('always sets book=1', () => {
    expect(bookingParams()).toEqual({ book: '1' });
  });
  it('adds the service prefill', () => {
    expect(bookingParams({ serviceTypeId: 'svc_1' })).toEqual({ book: '1', bookService: 'svc_1' });
  });
  it('adds both prefills', () => {
    expect(bookingParams({ serviceTypeId: 'svc_1', propertyId: 'prop_2' })).toEqual({
      book: '1',
      bookService: 'svc_1',
      bookProperty: 'prop_2',
    });
  });
});
