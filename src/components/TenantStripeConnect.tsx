'use client';

import React from 'react';
import { AlertTriangle, CreditCard, Info } from 'lucide-react';
import {
  ConnectComponentsProvider,
  ConnectAccountOnboarding,
  ConnectPayouts,
  ConnectNotificationBanner,
} from '@stripe/react-connect-js';
import { useTenantConnect, type TenantConnectStatus } from '../hooks/useTenantConnect';
import StripeFramedCard from './settings/StripeFramedCard';

export function tenantStatusKind(
  status: TenantConnectStatus | null,
  loading: boolean,
): 'active' | 'pending' | 'inactive' | 'loading' {
  if (loading) return 'loading';
  if (!status) return 'inactive';
  if (status.chargesEnabled) return 'active';
  if (
    status.hasAccount &&
    (status.detailsSubmitted || (status.requirementsDue?.length ?? 0) > 0)
  ) {
    return 'pending';
  }
  return 'inactive';
}

/**
 * Return true when the iframe-bearing `<ConnectComponentsProvider>` MUST be replaced
 * with the loading skeleton.
 *
 * The critical invariant (incident 2026-05-28 follow-up): once we've successfully
 * loaded a `status` snapshot, this stays false for the rest of the session — even
 * while a background `statusLoading` refresh (kicked off by `onStepChange` /
 * `onLoadError` / `onExit`) is in flight. Toggling true after the first paint
 * unmounts the iframe; that destroys the popup window's `opener` reference and
 * the Stripe "Use existing Stripe account" / 2FA popup gets stuck on the loader
 * shim forever.
 */
export function shouldShowConnectSkeleton(args: {
  loading: boolean;
  connectInstance: unknown | null;
  status: TenantConnectStatus | null;
  statusLoading: boolean;
}): boolean {
  const { loading, connectInstance, status, statusLoading } = args;
  return loading || !connectInstance || (!status && statusLoading);
}

/**
 * Embedded Stripe Connect for the tenant — JUST the iframe portion.
 *
 * The status banner, the balance row, and the "Open Stripe dashboard" CTA all
 * live on the page (/settings/payments) wrapped around this component. This
 * component only renders the embedded onboarding OR the payouts table inside
 * a `<StripeFramedCard>` (fixed min-height → zero layout shift).
 *
 * Caller is responsible for the disabled-flag case; we expose the status via
 * `useTenantConnect()` so callers can decide how to chrome the page.
 */
export default function TenantStripeConnect({
  appearance,
}: {
  /** Optional Stripe Connect appearance override (redesign passes brand tokens). */
  appearance?: Parameters<typeof useTenantConnect>[0];
} = {}) {
  const {
    enabled,
    canSetup,
    connectInstance,
    initError,
    loading,
    status,
    statusLoading,
    drift,
    refreshStatus,
  } = useTenantConnect(appearance);

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/50 py-12 text-center">
        <CreditCard className="mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="max-w-sm text-sm text-muted-foreground">
          Payment setup isn’t available yet. It will appear here once enabled.
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

  // Hard-stop banner when drift is detected. The stored account ID and the one
  // Stripe is actually onboarding into don't match (incident 2026-05-28 pattern).
  // Self-recovery is unsafe — direct the user to platform support so an admin
  // can run the "Reset Connect" action.
  if (drift) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-5 w-5" />
          Stripe account mismatch detected
        </div>
        <p className="mb-3">
          Your tenant is linked to one Stripe Connect account, but our system observed
          onboarding progress on a different account (
          <span className="font-mono text-xs">{drift.observed_account_id}</span>). To
          avoid mis-routed payouts we’ve paused onboarding for this tenant.
        </p>
        <p>
          Please contact Nexxus support so we can reset your Stripe Connect link and
          retry from a clean slate.
        </p>
      </div>
    );
  }

  const isActive = !!status?.chargesEnabled;
  const isPending =
    !isActive &&
    !!status?.hasAccount &&
    (status?.detailsSubmitted || (status?.requirementsDue?.length ?? 0) > 0);

  // Skeleton ONLY on first load — see shouldShowConnectSkeleton's JSDoc for why
  // we cannot ever unmount the iframe-bearing provider once it has rendered.
  if (shouldShowConnectSkeleton({ loading, connectInstance, status, statusLoading })) {
    return <StripeFramedCard loading />;
  }

  // Viewer (non-owner admin / manager-with-can_manage_payments): read-only
  // financials. No onboarding, account management, or notification banner — those
  // are setup surfaces the owner owns. The viewer Account Session only enables
  // balances/payouts/payments, so we mount just the payouts table (it carries the
  // balance + payout history). Before the owner connects the business there is no
  // session to show, so render a "being set up" state instead of the iframe.
  if (!canSetup) {
    if (!isActive) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/50 py-12 text-center">
          <CreditCard className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Your organization owner is still setting up payments. Your balance and
            payouts will show up here once the business is connected.
          </p>
        </div>
      );
    }
    return (
      <StripeFramedCard>
        <ConnectComponentsProvider connectInstance={connectInstance!}>
          <ConnectPayouts />
        </ConnectComponentsProvider>
      </StripeFramedCard>
    );
  }

  // Owner: full setup experience.
  return (
    <>
      {/* The onboarding form below collects every outstanding requirement itself,
          and once active Stripe's own ConnectNotificationBanner surfaces new asks.
          So never enumerate raw requirement keys here; one calm line is enough. */}
      {isPending && (status?.requirementsDue?.length ?? 0) > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-control border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <Info className="size-4 flex-none text-primary-600" aria-hidden />
          <span>
            Stripe needs a few more details before you can take payments. Finish the
            steps below and you are all set.
          </span>
        </div>
      )}

      <StripeFramedCard>
        <ConnectComponentsProvider connectInstance={connectInstance!}>
          <ConnectNotificationBanner />
          {isActive ? (
            <ConnectPayouts />
          ) : (
            <ConnectAccountOnboarding
              onExit={() => {
                // Mirror the latest capability/requirements state into our DB + refresh.
                void refreshStatus();
              }}
              // Fires when Stripe finishes its required-info checks even before the
              // user closes the iframe. Mirror + drift-check immediately so we catch
              // the "use existing Stripe account" path (incident 2026-05-28) at the
              // earliest possible signal.
              onStepChange={() => {
                void refreshStatus();
              }}
              onLoadError={(err) => {
                console.error('Connect onboarding load error:', err);
                void refreshStatus();
              }}
            />
          )}
        </ConnectComponentsProvider>
      </StripeFramedCard>
    </>
  );
}
