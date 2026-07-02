import { describe, it, expect } from 'vitest';
import { toRequestPayload } from './useSubmitBookingRequest';
import { EMPTY_BOOKING } from './booking-types';

describe('toRequestPayload', () => {
  it('maps slots to scheduled_date/time and trims notes', () => {
    const p = toRequestPayload('org1', {
      ...EMPTY_BOOKING,
      propertyId: 'p1',
      serviceTypeId: 's1',
      slots: [{ date: '2026-07-05', time: '10:00' }],
      notes: '  hi  ',
      paymentMethodId: 'pm_1',
    });
    expect(p).toEqual({
      organizationId: 'org1',
      propertyId: 'p1',
      serviceTypeId: 's1',
      slots: [{ scheduled_date: '2026-07-05', scheduled_time: '10:00' }],
      specialRequests: 'hi',
      paymentMethodId: 'pm_1',
    });
  });
  it('sends null for empty notes and no card', () => {
    const p = toRequestPayload('org1', {
      ...EMPTY_BOOKING,
      propertyId: 'p1',
      serviceTypeId: 's1',
      slots: [{ date: '2026-07-05', time: '10:00' }],
    });
    expect(p.specialRequests).toBeNull();
    expect(p.paymentMethodId).toBeNull();
  });
});
