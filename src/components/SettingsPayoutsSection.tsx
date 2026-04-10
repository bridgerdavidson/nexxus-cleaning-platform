'use client';

import React from 'react';
import StripeConnectionCard from './StripeConnectionCard';
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
          Manage your Stripe Connect account for payouts.
        </p>
      </div>

      <StripeConnectionCard />
    </div>
  );
}
