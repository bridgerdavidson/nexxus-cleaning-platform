'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';
import { HomeownerAccountHubView } from './HomeownerAccountHubView';

/**
 * Homeowner Account hub: grouped entry rows to the five Account areas + sign out.
 * Payment methods is hidden unless the new charge flow UI is enabled.
 */
export function HomeownerAccountHub() {
  const { signOut } = useAuth();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function onConfirmSignOut() {
    setSigningOut(true);
    await signOut();
    // On success the auth listener routes to /login; keep the spinner until then.
  }

  return (
    <HomeownerAccountHubView
      showPaymentMethods={stripeNewChargeFlowUiEnabled()}
      signOutOpen={signOutOpen}
      signingOut={signingOut}
      onSignOutOpenChange={setSignOutOpen}
      onConfirmSignOut={onConfirmSignOut}
    />
  );
}
