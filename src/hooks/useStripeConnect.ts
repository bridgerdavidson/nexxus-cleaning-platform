'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';

function stripeUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === 'true';
}

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function openStripeUrl(url: string): boolean {
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  return win != null;
}

export interface StripeConnectStatus {
  has_account: boolean;
  onboarding_complete: boolean;
  payouts_enabled: boolean;
}

/**
 * Cleaner Stripe Connect STATUS hook. Reports the cleaner's onboarding/payout state and
 * exposes the Express-dashboard login link as a fallback. Onboarding itself is now
 * EMBEDDED (see `useCleanerConnect` + `CleanerStripeConnect`) — this hook no longer drives
 * an Account-Link redirect.
 */
export function useStripeConnect() {
  const { user } = useAuth();

  const [statusLoading, setStatusLoading] = useState(true);
  const [connectStatus, setConnectStatus] = useState<StripeConnectStatus | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  // After the first successful fetchConnectStatus we stop flickering statusLoading.
  // Subsequent calls (kicked off by the cleaner_profiles realtime subscription,
  // by the stripe_return / stripe_refresh URL params, or by the embedded
  // ConnectAccountOnboarding's onExit / onStepChange / onLoadError callbacks)
  // must NOT toggle statusLoading true → false: CleanerStripeConnect's render
  // guard would tear down ConnectComponentsProvider and unmount the iframe in
  // the middle of bank-linking — exactly the incident that left the cleaner
  // looping on "Select an account for payouts" forever.
  const statusInitializedRef = useRef(false);

  const enabled = !!user?.id && user.role === 'cleaner' && stripeUiEnabled();

  const fetchConnectStatus = useCallback(async () => {
    if (!enabled) {
      setStatusLoading(false);
      return;
    }

    if (!statusInitializedRef.current) setStatusLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/stripe/connect/account-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ cleaner_id: user!.id }),
      });
      const data = await res.json();
      if (data.success) {
        setConnectStatus({
          has_account: data.has_account,
          onboarding_complete: data.onboarding_complete,
          payouts_enabled: data.payouts_enabled,
        });
        statusInitializedRef.current = true;
      } else {
        setConnectError('Unable to check payout status. Please try again.');
      }
    } catch {
      setConnectError('Unable to check payout status. Please try again.');
    } finally {
      setStatusLoading(false);
    }
  }, [enabled, user?.id]);

  useEffect(() => {
    fetchConnectStatus();
  }, [fetchConnectStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_return') === 'true' || params.get('stripe_refresh') === 'true') {
      fetchConnectStatus();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchConnectStatus]);

  // Realtime: re-pull Stripe status when the Stripe webhook flips this
  // cleaner's onboarding flag. Without this, the cleaner has to refresh after
  // finishing Stripe onboarding for the UI to drop the "Connect with Stripe"
  // call to action.
  const cleanerId = user?.id ?? '';
  useSupabaseRealtimeSync({
    channelName: `cleaner_profiles:detail:${cleanerId}`,
    table: 'cleaner_profiles',
    filter: cleanerId ? `id=eq.${cleanerId}` : undefined,
    enabled: enabled && !!cleanerId,
    onEvent: () => {
      fetchConnectStatus();
    },
  });

  const handleOpenStripeDashboard = useCallback(async () => {
    if (!user?.id) return;
    setDashboardLoading(true);
    setConnectError(null);

    try {
      const token = await getAccessToken();
      const res = await fetch('/api/stripe/connect/login-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to get Stripe dashboard link');
      }

      if (!openStripeUrl(data.url)) {
        throw new Error(
          'Could not open Stripe in a new tab. Allow pop-ups for this site and try again.'
        );
      }
      setDashboardLoading(false);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Something went wrong');
      setDashboardLoading(false);
    }
  }, [user?.id]);

  return {
    enabled,
    connectStatus,
    statusLoading,
    dashboardLoading,
    connectError,
    handleOpenStripeDashboard,
    refetchStatus: fetchConnectStatus,
  };
}
