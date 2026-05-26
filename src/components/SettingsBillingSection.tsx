'use client';

import React from 'react';
import TenantStripeConnect from './TenantStripeConnect';

/**
 * "Payments" settings section for tenant admins — hosts the embedded Stripe
 * Connect onboarding for the organization (merchant of record).
 */
export default function SettingsBillingSection() {
  return <TenantStripeConnect />;
}
