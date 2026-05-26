'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import type { StripeConnectInstance } from '@stripe/connect-js';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

function tenantConnectUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_TENANT_CONNECT_ENABLED === 'true';
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export interface TenantConnectState {
  /** True when the tenant Connect UI should render (flag on, admin, publishable key present). */
  enabled: boolean;
  /** The initialized Stripe Connect instance for embedded components, or null until ready. */
  connectInstance: StripeConnectInstance | null;
  initError: string | null;
  loading: boolean;
  /** Ask the server to re-pull + mirror the connected account's status (call on onboarding exit). */
  refreshStatus: () => Promise<void>;
}

/**
 * Drives the tenant (organization) embedded Stripe Connect onboarding.
 *
 * Lazily creates a Stripe Connect instance whose `fetchClientSecret` hits
 * /api/stripe/tenant/connect/start — which idempotently creates the org's Express
 * account and returns a fresh Account Session client secret. The embedded
 * `ConnectAccountOnboarding` component consumes the instance.
 */
export function useTenantConnect(): TenantConnectState {
  const { user, currentOrganizationId } = useAuth();
  const enabled =
    !!currentOrganizationId &&
    user?.role === 'admin' &&
    tenantConnectUiEnabled() &&
    !!PUBLISHABLE_KEY;

  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Track WHICH org we last initialized for, not just "did we init", so an org switch
  // (multi-org users, org-switch flows, context refresh) re-creates the Connect instance
  // instead of keeping a stale one bound to the previous tenant account.
  const initedForOrgRef = useRef<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!currentOrganizationId) return;
    const token = await getAccessToken();
    await fetch('/api/stripe/tenant/connect/refresh-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organization_id: currentOrganizationId }),
    }).catch(() => {
      /* best-effort; account.updated webhook is the backstop */
    });
  }, [currentOrganizationId]);

  useEffect(() => {
    if (!enabled) return;
    // Re-initialize only when the org actually changes (or on first init for it).
    if (initedForOrgRef.current === currentOrganizationId) return;
    initedForOrgRef.current = currentOrganizationId ?? null;
    setLoading(true);
    setInitError(null);
    setConnectInstance(null); // drop any stale instance bound to the previous org

    const fetchClientSecret = async (): Promise<string> => {
      const token = await getAccessToken();
      const res = await fetch('/api/stripe/tenant/connect/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: currentOrganizationId }),
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
        appearance: {
          // Match the brand yellow (tailwind primary-500 = #F7C41E).
          variables: { colorPrimary: '#F7C41E' },
        },
      });
      setConnectInstance(instance);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to initialize Stripe Connect');
    } finally {
      setLoading(false);
    }
  }, [enabled, currentOrganizationId]);

  return { enabled, connectInstance, initError, loading, refreshStatus };
}
