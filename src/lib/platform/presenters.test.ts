import { describe, it, expect } from 'vitest';
import {
  formatCents,
  subscriptionPillMeta,
  paymentsPillMeta,
  auditActionMeta,
} from './presenters';

describe('formatCents', () => {
  it('formats integer cents as USD', () => {
    expect(formatCents(286330)).toBe('$2,863.30');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(500)).toBe('$5.00');
    expect(formatCents(1234567)).toBe('$12,345.67');
  });
});

describe('subscriptionPillMeta', () => {
  it('maps known statuses to variant + label', () => {
    expect(subscriptionPillMeta('active')).toMatchObject({ variant: 'positive', label: 'Active' });
    expect(subscriptionPillMeta('trialing')).toMatchObject({ variant: 'caution', label: 'Trial' });
    expect(subscriptionPillMeta('past_due')).toMatchObject({ variant: 'critical', label: 'Past due' });
    expect(subscriptionPillMeta('canceled')).toMatchObject({ variant: 'secondary', label: 'Canceled' });
  });
  it('falls back to a neutral pill for unknown/none', () => {
    expect(subscriptionPillMeta('none')).toMatchObject({ variant: 'secondary', label: 'No plan' });
  });
});

describe('paymentsPillMeta', () => {
  const off = {
    stripe_connect_account_id: null,
    stripe_connect_charges_enabled: false,
    stripe_connect_payouts_enabled: false,
  };
  it('is Ready only when charges + payouts are both enabled', () => {
    expect(
      paymentsPillMeta({
        stripe_connect_account_id: 'acct_1',
        stripe_connect_charges_enabled: true,
        stripe_connect_payouts_enabled: true,
      }),
    ).toMatchObject({ variant: 'positive', label: 'Ready' });
  });
  it('is Onboarding when an account exists but is not fully enabled', () => {
    expect(
      paymentsPillMeta({ ...off, stripe_connect_account_id: 'acct_1', stripe_connect_charges_enabled: true }),
    ).toMatchObject({ variant: 'caution', label: 'Onboarding' });
  });
  it('is Not connected without an account', () => {
    expect(paymentsPillMeta(off)).toMatchObject({ variant: 'secondary', label: 'Not connected' });
  });
});

describe('auditActionMeta', () => {
  it('maps known actions to friendly labels', () => {
    expect(auditActionMeta('delete_tenant')).toEqual({ label: 'Deleted tenant', variant: 'critical' });
    expect(auditActionMeta('impersonation_start')).toEqual({ label: 'Viewed as company', variant: 'info' });
    expect(auditActionMeta('reset_cleaner_connect')).toMatchObject({ variant: 'caution' });
  });
  it('humanizes an unknown action', () => {
    expect(auditActionMeta('some_new_action')).toEqual({ label: 'Some new action', variant: 'default' });
  });
});
