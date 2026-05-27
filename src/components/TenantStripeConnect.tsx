'use client';

import React from 'react';
import { Loader2, CreditCard, CheckCircle, AlertTriangle } from 'lucide-react';
import {
  ConnectComponentsProvider,
  ConnectAccountOnboarding,
  ConnectAccountManagement,
  ConnectBalances,
  ConnectPayouts,
  ConnectNotificationBanner,
} from '@stripe/react-connect-js';
import { useTenantConnect } from '../hooks/useTenantConnect';

/** Humanize a Stripe `requirements.currently_due` key (e.g. `business_profile.url`). */
function prettyRequirement(key: string): string {
  return key
    .replace(/^individual\./, '')
    .replace(/^business_profile\./, '')
    .replace(/^company\./, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Embedded Stripe Connect for the tenant (cleaning company) — the merchant of record.
 * Status-aware: shows onboarding until the account is submitted, a "verifying / action
 * needed" view while Stripe finishes review or needs more info, and the balance/payout
 * views once charges are enabled. Everything renders inline so the tenant never leaves
 * the app.
 *
 * Gated by NEXT_PUBLIC_STRIPE_TENANT_CONNECT_ENABLED + admin/owner role + a publishable
 * key (see useTenantConnect). When disabled, renders a quiet placeholder.
 */
export default function TenantStripeConnect() {
  const { enabled, connectInstance, initError, loading, status, statusLoading, refreshStatus } =
    useTenantConnect();

  if (!enabled) {
    return (
      <div className="card flex flex-col items-center justify-center text-center py-24 mx-1 md:mx-0">
        <CreditCard className="w-8 h-8 text-gray-300 mb-3" />
        <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-2">Payments</h2>
        <p className="text-gray-500 max-w-sm mt-1">
          Online payment setup isn’t available yet. It will appear here once enabled.
        </p>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="card py-12 px-6 mx-1 md:mx-0">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-2">Payments</h2>
        <p className="text-red-600 max-w-md">{initError}</p>
      </div>
    );
  }

  if (loading || statusLoading || !connectInstance) {
    return (
      <div className="card flex flex-col items-center justify-center text-center py-24 mx-1 md:mx-0">
        <Loader2 className="w-7 h-7 animate-spin text-primary-600 mb-3" />
        <p className="text-gray-500">Loading payment setup…</p>
      </div>
    );
  }

  const isActive = !!status?.chargesEnabled;
  // Submitted to Stripe but not yet chargeable, or Stripe is asking for more info.
  const isPending =
    !isActive &&
    !!status?.hasAccount &&
    (status.detailsSubmitted || (status.requirementsDue?.length ?? 0) > 0);

  return (
    <div className="card py-8 px-5 md:px-8 mx-1 md:mx-0">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
          {isActive ? (
            <>
              <CheckCircle className="w-5 h-5 text-success-600" /> Payments connected
            </>
          ) : isPending ? (
            <>
              <AlertTriangle className="w-5 h-5 text-yellow-500" /> Verifying your account
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5 text-gray-400" /> Set up payments
            </>
          )}
        </h2>
        <p className="text-gray-500 mt-1 max-w-xl">
          {isActive
            ? 'Your company is the merchant of record. Homeowner payments settle to your balance and pay out to your bank on Stripe’s standard schedule.'
            : isPending
              ? 'Stripe is reviewing your details. If anything else is needed, finish it below — you can come back any time.'
              : 'Connect your business to start accepting homeowner payments. Your company is the merchant of record — payouts land in your bank account.'}
        </p>
      </div>

      {isPending && (status.requirementsDue?.length ?? 0) > 0 && (
        <div className="mb-6 rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
          <p className="font-semibold mb-1">Stripe still needs:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {status.requirementsDue.map((r) => (
              <li key={r}>{prettyRequirement(r)}</li>
            ))}
          </ul>
        </div>
      )}

      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectNotificationBanner />
        {isActive ? (
          <div className="space-y-8 mt-4">
            <ConnectBalances />
            <ConnectPayouts />
            <ConnectAccountManagement />
          </div>
        ) : (
          <ConnectAccountOnboarding
            onExit={() => {
              // Mirror the latest capability/requirements state into our DB + refresh the view.
              void refreshStatus();
            }}
          />
        )}
      </ConnectComponentsProvider>
    </div>
  );
}
