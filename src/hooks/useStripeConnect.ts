'use client';

import { useState, useEffect, useCallback } from 'react';
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

export function useStripeConnect() {
  const { user } = useAuth();

  const [connectLoading, setConnectLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connectStatus, setConnectStatus] = useState<StripeConnectStatus | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const enabled = !!user?.id && user.role === 'cleaner' && stripeUiEnabled();

  const fetchConnectStatus = useCallback(async () => {
    if (!enabled) {
      setStatusLoading(false);
      return;
    }

    setStatusLoading(true);
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

  const handleConnectWithStripe = useCallback(async () => {
    if (!user?.id) return;
    setConnectLoading(true);
    setConnectError(null);

    try {
      const token = await getAccessToken();
      const authHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const createRes = await fetch('/api/stripe/connect/create-account', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create Stripe account');
      }

      const linkRes = await fetch('/api/stripe/connect/onboarding-link', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok || !linkData.success) {
        throw new Error(linkData.error || 'Failed to get onboarding link');
      }

      if (!openStripeUrl(linkData.url)) {
        throw new Error(
          'Could not open Stripe in a new tab. Allow pop-ups for this site and try again.'
        );
      }
      setConnectLoading(false);
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Something went wrong');
      setConnectLoading(false);
    }
  }, [user?.id]);

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
    connectLoading,
    dashboardLoading,
    connectError,
    handleConnectWithStripe,
    handleOpenStripeDashboard,
    refetchStatus: fetchConnectStatus,
  };
}
