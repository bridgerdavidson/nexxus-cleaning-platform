import { describe, it, expect } from 'vitest';
import { pickBookingDefaults, type AppointmentLike } from './deriveBookingDefaults';

const appt = (over: Partial<AppointmentLike>): AppointmentLike => ({
  property_id: 'p1',
  service_type_id: 's1',
  status: 'completed',
  ...over,
});

describe('pickBookingDefaults', () => {
  it('returns null for an empty or missing list', () => {
    expect(pickBookingDefaults([])).toBeNull();
    expect(pickBookingDefaults(null)).toBeNull();
    expect(pickBookingDefaults(undefined)).toBeNull();
  });

  it('returns null when no appointment carries both a property and a service', () => {
    expect(pickBookingDefaults([appt({ property_id: null }), appt({ service_type_id: undefined })])).toBeNull();
  });

  it('prefers the most recent COMPLETED cleaning (list is ascending by date)', () => {
    const defaults = pickBookingDefaults([
      appt({ property_id: 'old', service_type_id: 'oldsvc', status: 'completed' }),
      appt({ property_id: 'new', service_type_id: 'newsvc', status: 'completed' }),
      // A later future/pending booking must NOT win over the most recent completed one.
      appt({ property_id: 'future', service_type_id: 'futuresvc', status: 'pending' }),
    ]);
    expect(defaults).toEqual({ propertyId: 'new', serviceTypeId: 'newsvc' });
  });

  it('falls back to the most recent appointment of any status when none are completed', () => {
    const defaults = pickBookingDefaults([
      appt({ property_id: 'p1', service_type_id: 's1', status: 'cancelled' }),
      appt({ property_id: 'p2', service_type_id: 's2', status: 'pending' }),
    ]);
    expect(defaults).toEqual({ propertyId: 'p2', serviceTypeId: 's2' });
  });

  it('skips rows missing an id when choosing the most recent', () => {
    const defaults = pickBookingDefaults([
      appt({ property_id: 'p1', service_type_id: 's1', status: 'completed' }),
      appt({ property_id: 'p2', service_type_id: null, status: 'completed' }),
    ]);
    expect(defaults).toEqual({ propertyId: 'p1', serviceTypeId: 's1' });
  });
});
