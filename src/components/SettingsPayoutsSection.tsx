'use client';

import React from 'react';
import CleanerStripeConnect from './CleanerStripeConnect';
import CleanerPayoutsHistory from './CleanerPayoutsHistory';
import { useAuth } from '../hooks/useAuth';

function stripeUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === 'true';
}

export default function SettingsPayoutsSection() {
  const { user } = useAuth();

  if (!user || user.role !== 'cleaner' || !stripeUiEnabled()) {
    return null;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 mb-2">Payouts</h1>
        <p className="text-[15px] text-gray-500">
          Connect and manage your Stripe account for payouts — right here in the app.
        </p>
      </div>

      <CleanerStripeConnect />
      <CleanerPayoutsHistory />
    </div>
  );
}
