import { describe, it, expect } from 'vitest';
import { mapSubscriptionStatus } from './orgBilling';

describe('mapSubscriptionStatus', () => {
  it('passes through the directly-allowed statuses', () => {
    expect(mapSubscriptionStatus('trialing')).toBe('trialing');
    expect(mapSubscriptionStatus('active')).toBe('active');
    expect(mapSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapSubscriptionStatus('canceled')).toBe('canceled');
  });

  it('keeps unpaid its own status (retries exhausted, org freezes)', () => {
    expect(mapSubscriptionStatus('unpaid')).toBe('unpaid');
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
    const allowed = new Set(['none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled']);
    for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'weird', null, undefined]) {
      expect(allowed.has(mapSubscriptionStatus(s))).toBe(true);
    }
  });
});

describe('mapSubscriptionStatus unpaid', () => {
  it('keeps unpaid distinct from past_due', () => {
    expect(mapSubscriptionStatus('past_due')).toBe('past_due');
    expect(mapSubscriptionStatus('unpaid')).toBe('unpaid');
  });

  it('still collapses the states that have no row value', () => {
    expect(mapSubscriptionStatus('incomplete')).toBe('none');
    expect(mapSubscriptionStatus('paused')).toBe('none');
    expect(mapSubscriptionStatus(null)).toBe('none');
    expect(mapSubscriptionStatus('something_new')).toBe('none');
  });

  it('still maps the terminal states to canceled', () => {
    expect(mapSubscriptionStatus('canceled')).toBe('canceled');
    expect(mapSubscriptionStatus('incomplete_expired')).toBe('canceled');
  });
});
