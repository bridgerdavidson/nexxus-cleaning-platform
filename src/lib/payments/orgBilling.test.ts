import { describe, it, expect } from 'vitest';
import { mapSubscriptionStatus } from './orgBilling';

describe('mapSubscriptionStatus', () => {
  it('passes through the directly-allowed statuses', () => {
    expect(mapSubscriptionStatus('trialing')).toBe('trialing');
    expect(mapSubscriptionStatus('active')).toBe('active');
    expect(mapSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapSubscriptionStatus('canceled')).toBe('canceled');
  });

  it('maps unpaid → past_due (still owed, not yet terminal)', () => {
    expect(mapSubscriptionStatus('unpaid')).toBe('past_due');
  });

  it('maps incomplete_expired → canceled (terminal)', () => {
    expect(mapSubscriptionStatus('incomplete_expired')).toBe('canceled');
  });

  it('maps not-yet-active / unknown states to none', () => {
    expect(mapSubscriptionStatus('incomplete')).toBe('none');
    expect(mapSubscriptionStatus('paused')).toBe('none');
    expect(mapSubscriptionStatus('something_new')).toBe('none');
    expect(mapSubscriptionStatus(null)).toBe('none');
    expect(mapSubscriptionStatus(undefined)).toBe('none');
  });

  it('only ever returns a status the organizations check constraint allows', () => {
    const allowed = new Set(['none', 'trialing', 'active', 'past_due', 'canceled']);
    for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'weird', null, undefined]) {
      expect(allowed.has(mapSubscriptionStatus(s))).toBe(true);
    }
  });
});
