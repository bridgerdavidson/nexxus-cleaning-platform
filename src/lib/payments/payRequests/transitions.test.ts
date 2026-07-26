import { describe, expect, it } from 'vitest';
import { initialStatus, nextStatus, PayRequestTransitionError } from './transitions';

describe('initialStatus', () => {
  it('cleaner submit within threshold goes straight to approved', () => {
    expect(initialStatus('cleaner', true)).toBe('approved');
  });

  it('cleaner submit over threshold waits on the org', () => {
    expect(initialStatus('cleaner', false)).toBe('pending_org');
  });

  it('an org-authored amount always awaits the cleaner (consent symmetry)', () => {
    expect(initialStatus('org', true)).toBe('pending_cleaner');
    expect(initialStatus('org', false)).toBe('pending_cleaner');
  });
});

describe('nextStatus', () => {
  it('pending_org + org_approve -> approved', () => {
    expect(nextStatus('pending_org', 'org_approve')).toBe('approved');
  });

  it('pending_org + org_counter -> pending_cleaner', () => {
    expect(nextStatus('pending_org', 'org_counter')).toBe('pending_cleaner');
  });

  it('pending_cleaner + cleaner_accept -> approved', () => {
    expect(nextStatus('pending_cleaner', 'cleaner_accept')).toBe('approved');
  });

  it('pending_cleaner + cleaner_counter re-runs the threshold', () => {
    expect(nextStatus('pending_cleaner', 'cleaner_counter', { autoApproved: true })).toBe('approved');
    expect(nextStatus('pending_cleaner', 'cleaner_counter', { autoApproved: false })).toBe('pending_org');
  });

  it('every other combination throws, including anything from approved', () => {
    expect(() => nextStatus('approved', 'org_approve')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('approved', 'org_counter')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('approved', 'cleaner_accept')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('approved', 'cleaner_counter')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_org', 'cleaner_accept')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_org', 'cleaner_counter')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_cleaner', 'org_approve')).toThrow(PayRequestTransitionError);
    expect(() => nextStatus('pending_cleaner', 'org_counter')).toThrow(PayRequestTransitionError);
  });
});
