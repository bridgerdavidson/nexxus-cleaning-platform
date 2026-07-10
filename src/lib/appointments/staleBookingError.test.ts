import { describe, expect, it } from 'vitest';
import { isStaleAcceptError } from './staleBookingError';

describe('isStaleAcceptError', () => {
  it('recognizes the three accept-counter-proposal stale failures', () => {
    expect(isStaleAcceptError('Suggested time not found')).toBe(true);
    expect(isStaleAcceptError('Suggested time does not belong to this appointment')).toBe(true);
    expect(isStaleAcceptError('Appointment is not awaiting counter-proposal acceptance')).toBe(true);
  });

  it('passes other errors through', () => {
    expect(isStaleAcceptError('Requires the Handle Requests permission')).toBe(false);
    expect(isStaleAcceptError('Appointment not found')).toBe(false);
    expect(isStaleAcceptError('')).toBe(false);
    expect(isStaleAcceptError(null)).toBe(false);
    expect(isStaleAcceptError(undefined)).toBe(false);
  });
});
