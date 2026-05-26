'use client';

import React from 'react';
import { Loader2, CreditCard, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import {
  ConnectComponentsProvider,
  ConnectAccountOnboarding,
  ConnectAccountManagement,
  ConnectBalances,
  ConnectPayouts,
} from '@stripe/react-connect-js';
import { useCleanerConnect } from '../hooks/useCleanerConnect';
import { useStripeConnect } from '../hooks/useStripeConnect';

/**
 * Embedded Stripe Connect onboarding + payout views for a cleaner (percentage contractor).
 * Renders Stripe's Connect components inline so the cleaner finishes payout setup and sees
 * their balance/payouts WITHOUT leaving the app — replacing the old Account-Link redirect.
 *
 * Status (from useStripeConnect) drives which view shows:
 *   - Not started / setup incomplete → embedded `account-onboarding`.
 *   - Active (payouts enabled)        → balances + payouts + account management.
 * The Express-dashboard login link remains as a fallback when active.
 */
export default function CleanerStripeConnect() {
  const { enabled, connectInstance, initError, loading } = useCleanerConnect();
  const {
    connectStatus,
    statusLoading,
    dashboardLoading,
    connectError,
    handleOpenStripeDashboard,
    refetchStatus,
  } = useStripeConnect();

  if (!enabled) return null;

  if (initError) {
    return (
      <div className="card py-8 px-5 md:px-8 mx-1 md:mx-0">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-2">Payouts</h2>
        <p className="text-red-600 max-w-md">{initError}</p>
      </div>
    );
  }

  if (loading || statusLoading || !connectInstance) {
    return (
      <div className="card flex flex-col items-center justify-center text-center py-24 mx-1 md:mx-0">
        <Loader2 className="w-7 h-7 animate-spin text-primary-600 mb-3" />
        <p className="text-gray-500">Loading payout setup…</p>
      </div>
    );
  }

  const isActive = !!connectStatus?.onboarding_complete;

  return (
    <div className="card py-8 px-5 md:px-8 mx-1 md:mx-0">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            {isActive ? (
              <>
                <CheckCircle className="w-5 h-5 text-success-600" /> Payouts active
              </>
            ) : connectStatus?.has_account ? (
              <>
                <AlertTriangle className="w-5 h-5 text-yellow-500" /> Finish payout setup
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5 text-gray-400" /> Set up payouts
              </>
            )}
          </h2>
          <p className="text-gray-500 mt-1 max-w-xl">
            {isActive
              ? 'Your Stripe account is connected. You receive automatic payouts when jobs complete.'
              : 'Connect your account to receive automatic payouts when jobs complete. You can finish everything right here — no need to leave the app.'}
          </p>
        </div>
        {isActive && (
          <button
            onClick={handleOpenStripeDashboard}
            disabled={dashboardLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-primary-700 bg-primary-50 rounded-xl hover:bg-primary-100 disabled:opacity-60 transition-colors flex-shrink-0"
          >
            {dashboardLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                Stripe dashboard <ExternalLink className="w-3 h-3" />
              </>
            )}
          </button>
        )}
      </div>

      {connectError && <p className="text-sm text-red-600 mb-4">{connectError}</p>}

      <ConnectComponentsProvider connectInstance={connectInstance}>
        {isActive ? (
          <div className="space-y-8">
            <ConnectBalances />
            <ConnectPayouts />
            <ConnectAccountManagement />
          </div>
        ) : (
          <ConnectAccountOnboarding
            onExit={() => {
              // Re-pull status so the view flips to "active" once Stripe enables payouts.
              void refetchStatus();
            }}
          />
        )}
      </ConnectComponentsProvider>
    </div>
  );
}
