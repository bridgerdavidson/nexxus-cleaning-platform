'use client';

import React from 'react';
import { Loader2, CreditCard } from 'lucide-react';
import {
  ConnectComponentsProvider,
  ConnectAccountOnboarding,
} from '@stripe/react-connect-js';
import { useTenantConnect } from '../hooks/useTenantConnect';

/**
 * Embedded Stripe Connect onboarding for the tenant (cleaning company).
 * Renders Stripe's `account-onboarding` component inline so the tenant never
 * leaves the app. The tenant becomes the merchant of record for homeowner charges.
 *
 * Gated by NEXT_PUBLIC_STRIPE_TENANT_CONNECT_ENABLED + admin role + a publishable
 * key (see useTenantConnect). When disabled, renders a quiet placeholder.
 */
export default function TenantStripeConnect() {
  const { enabled, connectInstance, initError, loading, refreshStatus } = useTenantConnect();

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

  if (loading || !connectInstance) {
    return (
      <div className="card flex flex-col items-center justify-center text-center py-24 mx-1 md:mx-0">
        <Loader2 className="w-7 h-7 animate-spin text-primary-600 mb-3" />
        <p className="text-gray-500">Loading payment setup…</p>
      </div>
    );
  }

  return (
    <div className="card py-8 px-5 md:px-8 mx-1 md:mx-0">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-gray-900">Set up payments</h2>
        <p className="text-gray-500 mt-1 max-w-xl">
          Connect your business to start accepting homeowner payments. Your company is the
          merchant of record — payouts land in your bank account on Stripe’s standard schedule.
        </p>
      </div>
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          onExit={() => {
            // Mirror the latest capability/requirements state into our DB.
            void refreshStatus();
          }}
        />
      </ConnectComponentsProvider>
    </div>
  );
}
