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
 * Embedded Stripe Connect for the cleaner — JUST the iframe portion.
 *
 * The status hero, the balance row, and the "Open Stripe dashboard" CTA all
 * live on /settings/payouts wrapped around this component. This component only
 * renders the embedded onboarding OR the payouts table inside a
 * `<StripeFramedCard>` (fixed min-height → zero layout shift).
 */
export default function CleanerStripeConnect() {
  const { enabled, connectInstance, initError, loading } = useCleanerConnect();
  const { connectStatus, statusLoading, connectError, refetchStatus } = useStripeConnect();

  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 py-12 text-center">
        <CreditCard className="mb-3 h-8 w-8 text-gray-300" />
        <p className="max-w-sm text-sm text-gray-500">
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

  if (loading || statusLoading || !connectInstance) {
    return <StripeFramedCard loading />;
  }

  const isActive = !!connectStatus?.onboarding_complete;

  return (
    <>
      {connectError && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{connectError}</div>
      )}
      <StripeFramedCard>
        <ConnectComponentsProvider connectInstance={connectInstance}>
          {isActive ? (
            <ConnectPayouts />
          ) : (
            <ConnectAccountOnboarding
              onExit={() => {
                void refetchStatus();
              }}
            />
          )}
        </ConnectComponentsProvider>
      </StripeFramedCard>
    </>
  );
}
