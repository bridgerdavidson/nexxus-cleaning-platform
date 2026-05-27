'use client';

import React from 'react';
import TenantStripeConnect from './TenantStripeConnect';
import OrgPaymentSettings from './OrgPaymentSettings';

/**
 * "Payments" settings section for tenant admins — the embedded Stripe Connect onboarding
 * (merchant of record) plus the org's cancellation/no-show policy.
 */
export default function SettingsBillingSection() {
  return (
    <div>
      <TenantStripeConnect />
      <OrgPaymentSettings />
    </div>
  );
}
