import { describe, it, expect } from 'vitest';
import { isCleanerPayable, type CleanerPayoutFields } from './isCleanerPayable';

/** A fully payout-ready cleaner; individual tests flip one field to assert the gate. */
const payable: CleanerPayoutFields = {
  payout_model: 'percentage',
  stripe_connect_account_id: 'acct_123',
  stripe_connect_onboarding_complete: true,
  payout_percent: 80,
};

describe('isCleanerPayable', () => {
  it('true when onboarded, has a Connect account, not hourly_external, and percent > 0', () => {
    expect(isCleanerPayable(payable)).toBe(true);
  });

  it('false for null / undefined', () => {
    expect(isCleanerPayable(null)).toBe(false);
    expect(isCleanerPayable(undefined)).toBe(false);
  });

  it('false when onboarding is not complete', () => {
    expect(isCleanerPayable({ ...payable, stripe_connect_onboarding_complete: false })).toBe(false);
    expect(isCleanerPayable({ ...payable, stripe_connect_onboarding_complete: null })).toBe(false);
  });

  it('false when there is no Connect account on file', () => {
    expect(isCleanerPayable({ ...payable, stripe_connect_account_id: null })).toBe(false);
    expect(isCleanerPayable({ ...payable, stripe_connect_account_id: '' })).toBe(false);
  });

  it('false for hourly_external cleaners (paid outside the app)', () => {
    expect(isCleanerPayable({ ...payable, payout_model: 'hourly_external' })).toBe(false);
  });

  it('false when payout_percent is zero or missing', () => {
    expect(isCleanerPayable({ ...payable, payout_percent: 0 })).toBe(false);
    expect(isCleanerPayable({ ...payable, payout_percent: null })).toBe(false);
    expect(isCleanerPayable({ ...payable, payout_percent: undefined })).toBe(false);
  });

  it('coerces a string payout_percent (the column can arrive as numeric text)', () => {
    expect(isCleanerPayable({ ...payable, payout_percent: '80' })).toBe(true);
    expect(isCleanerPayable({ ...payable, payout_percent: '0' })).toBe(false);
  });
});
