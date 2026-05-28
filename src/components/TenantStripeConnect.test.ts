import { describe, it, expect } from 'vitest';
import {
  shouldShowConnectSkeleton,
  tenantStatusKind,
} from './TenantStripeConnect';
import type { TenantConnectStatus } from '../hooks/useTenantConnect';

const SDK_INSTANCE = { __stripeConnectInstance: true } as const;

function status(overrides: Partial<TenantConnectStatus> = {}): TenantConnectStatus {
  return {
    hasAccount: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsDue: [],
    ...overrides,
  };
}

describe('shouldShowConnectSkeleton', () => {
  it('shows skeleton on first paint (no instance, no status)', () => {
    expect(
      shouldShowConnectSkeleton({
        loading: true,
        connectInstance: null,
        status: null,
        statusLoading: true,
      }),
    ).toBe(true);
  });

  it('shows skeleton while the SDK is still initializing', () => {
    expect(
      shouldShowConnectSkeleton({
        loading: true,
        connectInstance: null,
        status: status({ hasAccount: false }),
        statusLoading: false,
      }),
    ).toBe(true);
  });

  it('shows skeleton when the Connect SDK instance is missing', () => {
    expect(
      shouldShowConnectSkeleton({
        loading: false,
        connectInstance: null,
        status: status({ hasAccount: true }),
        statusLoading: false,
      }),
    ).toBe(true);
  });

  it('shows skeleton when status is null and initial load is still in flight', () => {
    expect(
      shouldShowConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        status: null,
        statusLoading: true,
      }),
    ).toBe(true);
  });

  it('does NOT show skeleton once both instance + status are ready', () => {
    expect(
      shouldShowConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        status: status({ hasAccount: true, requirementsDue: ['business_profile.url'] }),
        statusLoading: false,
      }),
    ).toBe(false);
  });

  // Regression for incident 2026-05-28 follow-up: every `refreshStatus()` call
  // flips `statusLoading` briefly while it re-reads the mirrored org row. Before
  // this fix, that flicker tore down the iframe-bearing provider, which orphaned
  // any popup Stripe had opened for 2FA / "Use existing Stripe account" sign-in.
  // The new guard MUST stay false in this state.
  it('does NOT show skeleton during a background refresh after first paint', () => {
    expect(
      shouldShowConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        status: status({ hasAccount: true, requirementsDue: ['business_profile.url'] }),
        statusLoading: true,
      }),
    ).toBe(false);
  });

  it('does NOT show skeleton during refresh on an active account either', () => {
    expect(
      shouldShowConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        status: status({
          hasAccount: true,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        }),
        statusLoading: true,
      }),
    ).toBe(false);
  });
});

describe('tenantStatusKind', () => {
  it('returns loading when loading is true regardless of status', () => {
    expect(tenantStatusKind(status({ chargesEnabled: true }), true)).toBe('loading');
    expect(tenantStatusKind(null, true)).toBe('loading');
  });

  it('returns inactive when status is null', () => {
    expect(tenantStatusKind(null, false)).toBe('inactive');
  });

  it('returns active when charges are enabled', () => {
    expect(
      tenantStatusKind(
        status({ hasAccount: true, chargesEnabled: true, detailsSubmitted: true }),
        false,
      ),
    ).toBe('active');
  });

  it('returns pending when an account exists with outstanding requirements', () => {
    expect(
      tenantStatusKind(
        status({ hasAccount: true, requirementsDue: ['business_profile.url'] }),
        false,
      ),
    ).toBe('pending');
  });

  it('returns pending when details_submitted is true but charges are not yet enabled', () => {
    expect(
      tenantStatusKind(
        status({ hasAccount: true, detailsSubmitted: true }),
        false,
      ),
    ).toBe('pending');
  });

  it('returns inactive when there is no account yet', () => {
    expect(
      tenantStatusKind(status({ hasAccount: false }), false),
    ).toBe('inactive');
  });
});
