'use client';

import React from 'react';
import { CreditCard } from 'lucide-react';
import {
  ConnectComponentsProvider,
  ConnectAccountOnboarding,
  ConnectPayouts,
  ConnectNotificationBanner,
} from '@stripe/react-connect-js';
import { useTenantConnect, type TenantConnectStatus } from '../hooks/useTenantConnect';
import StripeFramedCard from './settings/StripeFramedCard';

/** Humanize a Stripe `requirements.currently_due` key (e.g. `business_profile.url`). */
function prettyRequirement(key: string): string {
  return key
    .replace(/^individual\./, '')
    .replace(/^business_profile\./, '')
    .replace(/^company\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
export default function TenantStripeConnect() {
  const { enabled, connectInstance, initError, loading, status, statusLoading, refreshStatus } =
    useTenantConnect();

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 py-12 text-center">
        <CreditCard className="mb-3 h-8 w-8 text-gray-300" />
        <p className="max-w-sm text-sm text-gray-500">
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

  const isActive = !!status?.chargesEnabled;
  const isPending =
    !isActive &&
    !!status?.hasAccount &&
    (status?.detailsSubmitted || (status?.requirementsDue?.length ?? 0) > 0);

  // Skeleton while either the Connect instance or the mirrored status is loading.
  // StripeFramedCard's min-height is the same across loading and loaded states.
  if (loading || statusLoading || !connectInstance) {
    return <StripeFramedCard loading />;
  }

  return (
    <>
      {isPending && (status?.requirementsDue?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          <p className="mb-1 font-semibold">Stripe still needs:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {status!.requirementsDue.map((r) => (
              <li key={r}>{prettyRequirement(r)}</li>
            ))}
          </ul>
        </div>
      )}

      <StripeFramedCard>
        <ConnectComponentsProvider connectInstance={connectInstance}>
          <ConnectNotificationBanner />
          {isActive ? (
            <ConnectPayouts />
          ) : (
            <ConnectAccountOnboarding
              onExit={() => {
                // Mirror the latest capability/requirements state into our DB + refresh.
                void refreshStatus();
              }}
            />
          )}
        </ConnectComponentsProvider>
      </StripeFramedCard>
    </>
  );
}
