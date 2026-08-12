'use client';

import React from 'react';
import { CreditCard } from 'lucide-react';
import {
  ConnectComponentsProvider,
  ConnectAccountOnboarding,
  ConnectPayouts,
} from '@stripe/react-connect-js';
import { useCleanerConnect } from '../hooks/useCleanerConnect';
import { useStripeConnect, type StripeConnectStatus } from '../hooks/useStripeConnect';
import StripeFramedCard from './settings/StripeFramedCard';

export function cleanerStatusKind(
  status: StripeConnectStatus | null,
  loading: boolean,
): 'active' | 'pending' | 'inactive' | 'loading' {
  if (loading) return 'loading';
  if (!status) return 'inactive';
  if (status.onboarding_complete) return 'active';
  if (status.has_account) return 'pending';
  return 'inactive';
}

/**
 * Return true when the iframe-bearing `<ConnectComponentsProvider>` MUST be replaced
 * with the loading skeleton.
 *
 * The critical invariant (mirrors the tenant fix in `TenantStripeConnect`): once
 * we've successfully loaded a `connectStatus` snapshot, this stays false for the
 * rest of the session — even while a background `statusLoading` refresh (kicked
 * off by realtime, stripe_return URL params, or `onStepChange` / `onLoadError`
 * / `onExit` callbacks) is in flight. Toggling true after the first paint
 * unmounts the iframe; that destroys any popup Stripe spawned for the
 * Plaid / bank-login / "Allow" handshake (its `window.opener` goes dead) and
 * loops the cleaner back to "Select an account for payouts" every time.
 */
export function shouldShowCleanerConnectSkeleton(args: {
  loading: boolean;
  connectInstance: unknown | null;
  connectStatus: StripeConnectStatus | null;
  statusLoading: boolean;
}): boolean {
  const { loading, connectInstance, connectStatus, statusLoading } = args;
  return loading || !connectInstance || (!connectStatus && statusLoading);
}

/**
 * Embedded Stripe Connect for the cleaner — JUST the iframe portion.
 *
 * The status hero, the balance row, and the "Open Stripe dashboard" CTA all
 * live on /settings/payouts wrapped around this component. This component only
 * renders the embedded onboarding OR the payouts table inside a
 * `<StripeFramedCard>` (fixed min-height → zero layout shift).
 */
export default function CleanerStripeConnect({
  appearance,
  payoutsMaxHeight,
}: {
  /** Optional Stripe Connect appearance override (redesign passes brand tokens). */
  appearance?: Parameters<typeof useCleanerConnect>[0];
  /**
   * Optional Tailwind max-height class (e.g. `max-h-[460px]`) applied to the
   * embedded payouts table ONLY. Connect components grow with their content and
   * expose no height prop; per Stripe's docs the only supported way to bound them
   * is `max-height` + `overflow: scroll`. This stops the payout history from
   * growing the page without end and tames the load-time height creep. Onboarding
   * is never capped (its forms and bank-link popups must grow freely). Legacy
   * callers pass nothing and keep the uncapped behavior.
   */
  payoutsMaxHeight?: string;
} = {}) {
  const { enabled, connectInstance, initError, loading } = useCleanerConnect(appearance);
  const { connectStatus, statusLoading, connectError, refetchStatus } = useStripeConnect();

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/50 py-12 text-center">
        <CreditCard className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="max-w-sm text-sm text-muted-foreground">
          Payout setup isn’t available yet. It will appear here once enabled.
        </p>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {initError}
      </div>
    );
  }

  // Skeleton ONLY on first load — see shouldShowCleanerConnectSkeleton's JSDoc
  // for why we cannot ever unmount the iframe-bearing provider once it has
  // rendered.
  if (shouldShowCleanerConnectSkeleton({ loading, connectInstance, connectStatus, statusLoading })) {
    return <StripeFramedCard loading />;
  }

  const isActive = !!connectStatus?.onboarding_complete;

  return (
    <>
      {connectError && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{connectError}</div>
      )}
      <StripeFramedCard>
        <ConnectComponentsProvider connectInstance={connectInstance!}>
          {isActive ? (
            payoutsMaxHeight ? (
              <div className={`${payoutsMaxHeight} overflow-y-auto`}>
                <ConnectPayouts />
              </div>
            ) : (
              <ConnectPayouts />
            )
          ) : (
            <ConnectAccountOnboarding
              onExit={() => {
                void refetchStatus();
              }}
              // Fires when Stripe finishes a step (e.g. bank attach) before the
              // user closes the iframe. Mirror the latest capability state into
              // our DB at the earliest possible signal so the status hero flips
              // to "Active" without waiting for the user to click "Done".
              onStepChange={() => {
                void refetchStatus();
              }}
              onLoadError={(err) => {
                console.error('Cleaner Connect onboarding load error:', err);
                void refetchStatus();
              }}
            />
          )}
        </ConnectComponentsProvider>
      </StripeFramedCard>
    </>
  );
}
