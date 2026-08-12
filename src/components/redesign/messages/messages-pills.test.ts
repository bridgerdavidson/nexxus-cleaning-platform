import { describe, it, expect } from 'vitest';
import { BADGE } from '../bookings/bookings-presenters';
import { BOOKING_STATUS_VARIANT, ROLE_LABEL } from './messages-pills';

// D13: messaging status pills share the app-wide status-color source of truth
// (the bookings-presenters BADGE map). Copy is role-voiced per surface; the
// variant semantics must never drift again.
describe('BOOKING_STATUS_VARIANT', () => {
  it('stays in sync with the bookings-presenters BADGE map', () => {
    for (const status of Object.keys(BOOKING_STATUS_VARIANT) as Array<
      keyof typeof BOOKING_STATUS_VARIANT
    >) {
      expect(BOOKING_STATUS_VARIANT[status]).toBe(BADGE[status].variant);
    }
  });
});

describe('ROLE_LABEL', () => {
  it('covers every messageable role', () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual(['admin', 'cleaner', 'homeowner', 'manager']);
  });
});
