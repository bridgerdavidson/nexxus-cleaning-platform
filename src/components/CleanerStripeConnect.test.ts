import { describe, it, expect } from 'vitest';
import {
  cleanerStatusKind,
  shouldShowCleanerConnectSkeleton,
} from './CleanerStripeConnect';
import type { StripeConnectStatus } from '../hooks/useStripeConnect';

const SDK_INSTANCE = { __stripeConnectInstance: true } as const;

function status(overrides: Partial<StripeConnectStatus> = {}): StripeConnectStatus {
  return {
    has_account: false,
    onboarding_complete: false,
    payouts_enabled: false,
    ...overrides,
  };
}

describe('shouldShowCleanerConnectSkeleton', () => {
  it('shows skeleton on first paint (no instance, no status)', () => {
    expect(
      shouldShowCleanerConnectSkeleton({
        loading: true,
        connectInstance: null,
        connectStatus: null,
        statusLoading: true,
      }),
    ).toBe(true);
  });

  it('shows skeleton while the SDK is still initializing', () => {
    expect(
      shouldShowCleanerConnectSkeleton({
        loading: true,
        connectInstance: null,
        connectStatus: status({ has_account: false }),
        statusLoading: false,
      }),
    ).toBe(true);
  });

  it('shows skeleton when the Connect SDK instance is missing', () => {
    expect(
      shouldShowCleanerConnectSkeleton({
        loading: false,
        connectInstance: null,
        connectStatus: status({ has_account: true }),
        statusLoading: false,
      }),
    ).toBe(true);
  });

  it('shows skeleton when status is null and initial load is still in flight', () => {
    expect(
      shouldShowCleanerConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        connectStatus: null,
        statusLoading: true,
      }),
    ).toBe(true);
  });

  it('does NOT show skeleton once both instance + status are ready', () => {
    expect(
      shouldShowCleanerConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        connectStatus: status({ has_account: true }),
        statusLoading: false,
      }),
    ).toBe(false);
  });

  // Regression for the prod cleaner stuck-loop: every refetchStatus() call
  // (kicked off by cleaner_profiles realtime, stripe_return URL params, or
  // the Connect onboarding's onStepChange/onLoadError/onExit callbacks)
  // briefly flips statusLoading true. Before this fix, that flicker tore
  // down the iframe-bearing provider, which orphaned any popup Stripe had
  // opened for Plaid / bank-login / "Allow" — looping the cleaner back to
  // "Select an account for payouts" every time. Helper MUST stay false.
  it('does NOT show skeleton during a background refresh after first paint', () => {
    expect(
      shouldShowCleanerConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        connectStatus: status({ has_account: true }),
        statusLoading: true,
      }),
    ).toBe(false);
  });

  it('does NOT show skeleton during refresh on an onboarding-complete account either', () => {
    expect(
      shouldShowCleanerConnectSkeleton({
        loading: false,
        connectInstance: SDK_INSTANCE,
        connectStatus: status({
          has_account: true,
          onboarding_complete: true,
          payouts_enabled: true,
        }),
        statusLoading: true,
      }),
    ).toBe(false);
  });
});

describe('cleanerStatusKind', () => {
  it('returns loading when loading is true regardless of status', () => {
    expect(cleanerStatusKind(status({ onboarding_complete: true }), true)).toBe('loading');
    expect(cleanerStatusKind(null, true)).toBe('loading');
  });

  it('returns inactive when status is null', () => {
    expect(cleanerStatusKind(null, false)).toBe('inactive');
  });

  it('returns active when onboarding is complete', () => {
    expect(
      cleanerStatusKind(
        status({ has_account: true, onboarding_complete: true, payouts_enabled: true }),
        false,
      ),
    ).toBe('active');
  });

  it('returns pending when an account exists but onboarding is not complete', () => {
    expect(
      cleanerStatusKind(status({ has_account: true }), false),
    ).toBe('pending');
  });

  it('returns inactive when there is no account yet', () => {
    expect(
      cleanerStatusKind(status({ has_account: false }), false),
    ).toBe('inactive');
  });
});
