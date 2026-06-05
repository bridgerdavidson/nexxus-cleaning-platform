import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// Capture the params handed to accountSessions.create without touching real Stripe.
const createMock = vi.fn(async () => ({ client_secret: 'accs_test', object: 'account_session' }));
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ accountSessions: { create: createMock } }),
}));

import { createTenantAccountSession } from './tenant';

type Components = Stripe.AccountSessionCreateParams.Components;
function componentsOf(): Components {
  return createMock.mock.calls[0][0].components as Components;
}

describe('createTenantAccountSession', () => {
  beforeEach(() => createMock.mockClear());

  it('owner scope enables the setup surfaces + full financials', async () => {
    await createTenantAccountSession('acct_123', 'owner');
    expect(createMock.mock.calls[0][0].account).toBe('acct_123');
    const c = componentsOf();
    expect(c.account_onboarding).toEqual({ enabled: true });
    expect(c.account_management).toEqual({ enabled: true });
    expect(c.notification_banner).toEqual({ enabled: true });
    expect(c.balances?.enabled).toBe(true);
    expect(c.payouts?.enabled).toBe(true);
    expect(c.payments?.enabled).toBe(true);
  });

  it('defaults to owner scope when none is passed', async () => {
    await createTenantAccountSession('acct_123');
    expect(componentsOf().account_onboarding).toEqual({ enabled: true });
  });

  it('viewer scope shows read-only financials and NO setup surfaces', async () => {
    await createTenantAccountSession('acct_123', 'viewer');
    const c = componentsOf();
    // Setup surfaces are owner-only: never present for a viewer.
    expect(c.account_onboarding).toBeUndefined();
    expect(c.account_management).toBeUndefined();
    expect(c.notification_banner).toBeUndefined();
    // Financials are visible...
    expect(c.balances?.enabled).toBe(true);
    expect(c.payouts?.enabled).toBe(true);
    expect(c.payments?.enabled).toBe(true);
    // ...but every management/edit feature is off. disable_stripe_user_authentication
    // is intentionally NOT set — Stripe only allows it on Custom accounts (these
    // tenants are Express), and the read components don't need it.
    expect(c.balances?.features?.external_account_collection).toBe(false);
    expect(c.balances?.features?.disable_stripe_user_authentication).toBeUndefined();
    expect(c.payouts?.features?.edit_payout_schedule).toBe(false);
    expect(c.payouts?.features?.external_account_collection).toBe(false);
    expect(c.payouts?.features?.disable_stripe_user_authentication).toBeUndefined();
    expect(c.payments?.features?.refund_management).toBe(false);
    expect(c.payments?.features?.dispute_management).toBe(false);
    expect(c.payments?.features?.capture_payments).toBe(false);
  });
});
