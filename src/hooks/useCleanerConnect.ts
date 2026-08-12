'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import type { StripeConnectInstance } from '@stripe/connect-js';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import { getRedesignConnectAppearance } from '../lib/stripe/appearance';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

function stripeUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === 'true';
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export interface CleanerConnectState {
  /** True when the embedded cleaner Connect UI should render (cleaner role + flag + key). */
  enabled: boolean;
  /** The initialized Stripe Connect instance for embedded components, or null until ready. */
  connectInstance: StripeConnectInstance | null;
  initError: string | null;
  loading: boolean;
}

/**
 * Drives the cleaner's embedded Stripe Connect onboarding + payout views.
 *
 * Lazily creates a Stripe Connect instance whose `fetchClientSecret` hits
 * /api/stripe/connect/cleaner/start — which idempotently creates the cleaner's Express
 * account and returns a fresh Account Session client secret. The embedded
 * `ConnectAccountOnboarding` / `ConnectBalances` / `ConnectPayouts` components consume it,
 * so the cleaner never leaves the app. Mirrors `useTenantConnect`.
 */
export function useCleanerConnect(
  appearanceOverride?: Parameters<typeof loadConnectAndInitialize>[0]["appearance"],
): CleanerConnectState {
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const enabled =
    !!user?.id && user.role === 'cleaner' && stripeUiEnabled() && !!PUBLISHABLE_KEY;

  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Track which user we initialized for so an account switch re-creates the instance.
  const initedForRef = useRef<string | null>(null);

  // NOTE: appearanceOverride is intentionally NOT in the deps below. It is consumed
  // once at loadConnectAndInitialize time; re-running the effect would re-create the
  // Connect instance and tear down any in-flight bank-link popup (window.opener dies).
  useEffect(() => {
    if (!enabled || !user?.id) return;
    if (initedForRef.current === user.id) return;
    initedForRef.current = user.id;
    setLoading(true);
    setInitError(null);
    setConnectInstance(null);

    const cleanerId = user.id;
    const fetchClientSecret = async (): Promise<string> => {
      const token = await getAccessToken();
      const res = await fetch('/api/stripe/connect/cleaner/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ cleaner_id: cleanerId }),
      });
      const data = await res.json();
      if (!res.ok || !data.client_secret) {
        throw new Error(data.error || 'Failed to start onboarding');
      }
      return data.client_secret as string;
    };

    try {
      const instance = loadConnectAndInitialize({
        publishableKey: PUBLISHABLE_KEY,
        fetchClientSecret,
        // Caller-supplied theme (redesign, theme-aware) wins; otherwise the
        // current app theme at init time (picked up on the next mount after a
        // mid-session toggle; re-init here would break the Connect popup flow).
        appearance: appearanceOverride ?? getRedesignConnectAppearance(resolvedTheme === 'dark'),
      });
      setConnectInstance(instance);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to initialize Stripe Connect');
    } finally {
      setLoading(false);
    }
  }, [enabled, user?.id]);

  return { enabled, connectInstance, initError, loading };
}
