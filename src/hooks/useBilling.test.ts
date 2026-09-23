// useBilling is a plain function that calls two mocked "hooks" (useAuth,
// useOrgQuery) and does synchronous derivation on their output, so it can be
// invoked directly as a function here without React rendering or jsdom.
//
// This exists specifically to catch two regressions the format.ts tests
// cannot: (1) dropping the local refetchOnWindowFocus override (ruling R19,
// a past_due banner that never self-heals after the customer pays in the
// Stripe portal tab), and (2) collapsing role-based access (isOwner /
// canSeeBillingChrome) to a constant.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BillingStatePayload } from '@/app/api/billing/state/route';

const useAuthMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

const useOrgQueryMock = vi.fn();
vi.mock('@/lib/useOrgQuery', () => ({
  useOrgQuery: (options: unknown) => useOrgQueryMock(options),
}));

const uiEnabledMock = vi.fn();
vi.mock('@/lib/billing/flags', () => ({
  billingEnforcementUiEnabled: () => uiEnabledMock(),
}));

vi.mock('@/components/redesign/billing/billing-api', () => ({
  fetchBillingState: vi.fn(),
}));

import { useBilling } from './useBilling';

function payload(over: Partial<BillingStatePayload> = {}): BillingStatePayload {
  return {
    billing: {
      subscription_status: 'active',
      trial_ends_at: null,
      trial_extended_at: null,
      comped_at: null,
      plan_tier: 'growth',
      billing_period: 'monthly',
      seat_count: 8,
      subscription_cancel_at: null,
      billing_paused_at: null,
      billing_pause_resumes_at: null,
    },
    seats_in_use: 5,
    role: 'admin',
    current_period_end: '2026-10-21T00:00:00.000Z',
    ...over,
  };
}

describe('useBilling', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ currentOrganizationId: 'org-1' });
    uiEnabledMock.mockReturnValue(true);
    useOrgQueryMock.mockReturnValue({ data: undefined, isLoading: true });
  });

  it('opts into refetchOnWindowFocus locally, overriding the global default of false', () => {
    useBilling();
    expect(useOrgQueryMock).toHaveBeenCalledTimes(1);
    const options = useOrgQueryMock.mock.calls[0][0] as { refetchOnWindowFocus?: boolean };
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it('gates the query on the uiEnabled flag, not unconditionally', () => {
    uiEnabledMock.mockReturnValue(false);
    useBilling();
    const options = useOrgQueryMock.mock.calls[0][0] as { enabled?: boolean };
    expect(options.enabled).toBe(false);
  });

  it('reports isOwner true only for an owner, not an admin or manager', () => {
    useOrgQueryMock.mockReturnValue({ data: payload({ role: 'owner' }), isLoading: false });
    expect(useBilling().isOwner).toBe(true);

    useOrgQueryMock.mockReturnValue({ data: payload({ role: 'admin' }), isLoading: false });
    expect(useBilling().isOwner).toBe(false);

    useOrgQueryMock.mockReturnValue({ data: payload({ role: 'manager' }), isLoading: false });
    expect(useBilling().isOwner).toBe(false);
  });

  it('canSeeBillingChrome is true for owner and admin, false for manager (ruling R15)', () => {
    useOrgQueryMock.mockReturnValue({ data: payload({ role: 'owner' }), isLoading: false });
    expect(useBilling().canSeeBillingChrome).toBe(true);

    useOrgQueryMock.mockReturnValue({ data: payload({ role: 'admin' }), isLoading: false });
    expect(useBilling().canSeeBillingChrome).toBe(true);

    useOrgQueryMock.mockReturnValue({ data: payload({ role: 'manager' }), isLoading: false });
    expect(useBilling().canSeeBillingChrome).toBe(false);
  });

  it('access is null when there is no billing data (e.g. a 403 for a disallowed role)', () => {
    useOrgQueryMock.mockReturnValue({ data: undefined, isLoading: false });
    const result = useBilling();
    expect(result.access).toBeNull();
    expect(result.billing).toBeNull();
    expect(result.role).toBeNull();
  });

  it('derives access from the billing row via deriveBillingAccess, not a hardcoded value', () => {
    useOrgQueryMock.mockReturnValue({
      data: payload({ billing: { ...payload().billing, comped_at: '2026-01-01T00:00:00.000Z' } }),
      isLoading: false,
    });
    expect(useBilling().access?.state).toBe('comped');

    useOrgQueryMock.mockReturnValue({
      data: payload({ billing: { ...payload().billing, subscription_status: 'past_due' } }),
      isLoading: false,
    });
    expect(useBilling().access?.state).toBe('past_due');
  });

  it('passes seats_in_use and current_period_end through unchanged', () => {
    useOrgQueryMock.mockReturnValue({
      data: payload({ seats_in_use: 12, current_period_end: '2027-03-01T00:00:00.000Z' }),
      isLoading: false,
    });
    const result = useBilling();
    expect(result.seatsInUse).toBe(12);
    expect(result.currentPeriodEnd).toBe('2027-03-01T00:00:00.000Z');
  });
});
