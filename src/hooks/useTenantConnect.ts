'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import type { StripeConnectInstance } from '@stripe/connect-js';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';

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

export interface TenantConnectStatus {
  /** Whether the org has a connected account yet. */
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
}

/**
 * Drift state for the tenant org: we stored acct `expected_account_id` but Stripe
 * appears to have onboarded the user into `observed_account_id` instead (the
 * "Use existing Stripe account" path from incident 2026-05-28). The UI gates the
 * iframe and directs the user to platform support — manual reset clears it.
 */
export interface TenantConnectDrift {
  observed_account_id: string;
  expected_account_id: string | null;
  source: 'webhook' | 'refresh-status' | 'manual';
  detected_at: string;
}

export interface TenantConnectState {
  /** True when the tenant Connect UI should render (flag on, admin, publishable key present). */
  enabled: boolean;
  /** The initialized Stripe Connect instance for embedded components, or null until ready. */
  connectInstance: StripeConnectInstance | null;
  initError: string | null;
  loading: boolean;
  /** Mirrored connected-account capability state for the org (null until first load). */
  status: TenantConnectStatus | null;
  statusLoading: boolean;
  /** Open drift event for the org if one exists — UI must gate the iframe when truthy. */
  drift: TenantConnectDrift | null;
  /** Ask the server to re-pull + mirror the connected account's status, then refresh local state. */
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
  const { currentOrganizationId, currentOrgRole } = useAuth();
  // Gate by OrgRole (owner|admin) to match the backend (requireOrgAuth allows owner+admin).
  // `user.role` is the UserRole and has no `owner`, so an owner whose UserRole isn't `admin`
  // would otherwise be locked out of onboarding their own org.
  const enabled =
    !!currentOrganizationId &&
    (currentOrgRole === 'owner' || currentOrgRole === 'admin') &&
    tenantConnectUiEnabled() &&
    !!PUBLISHABLE_KEY;

  const [connectInstance, setConnectInstance] = useState<StripeConnectInstance | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TenantConnectStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [drift, setDrift] = useState<TenantConnectDrift | null>(null);
  // Track WHICH org we last initialized for, not just "did we init", so an org switch
  // (multi-org users, org-switch flows, context refresh) re-creates the Connect instance
  // instead of keeping a stale one bound to the previous tenant account.
  const initedForOrgRef = useRef<string | null>(null);
  // After the first successful loadStatus we stop flickering statusLoading. Subsequent
  // calls (from onStepChange / onExit / onLoadError) must NOT toggle it true→false:
  // TenantStripeConnect's render guard would tear down ConnectComponentsProvider,
  // unmounting the iframe — which orphans any popup window Stripe spawned for the
  // "Use existing Stripe account" / 2FA path (its window.opener goes dead).
  const statusInitializedRef = useRef(false);

  // Read the mirrored capability fields straight from the org row (kept current by the
  // account.updated webhook + refresh-status). This avoids a Stripe round-trip on render.
  const loadStatus = useCallback(async () => {
    if (!currentOrganizationId) return;
    if (!statusInitializedRef.current) setStatusLoading(true);
    const { data } = await supabase
      .from('organizations')
      .select(
        'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_requirements_due',
      )
      .eq('id', currentOrganizationId)
      .maybeSingle();
    const row = (data ?? {}) as {
      stripe_connect_account_id?: string | null;
      stripe_connect_charges_enabled?: boolean | null;
      stripe_connect_payouts_enabled?: boolean | null;
      stripe_connect_details_submitted?: boolean | null;
      stripe_connect_requirements_due?: string[] | null;
    };
    setStatus({
      hasAccount: !!row.stripe_connect_account_id,
      chargesEnabled: !!row.stripe_connect_charges_enabled,
      payoutsEnabled: !!row.stripe_connect_payouts_enabled,
      detailsSubmitted: !!row.stripe_connect_details_submitted,
      requirementsDue: row.stripe_connect_requirements_due ?? [],
    });
    statusInitializedRef.current = true;
    setStatusLoading(false);
  }, [currentOrganizationId]);

  // Check the drift-events table for an open event on this org. RLS lets owner+admin
  // SELECT their own org's events; webhook handler + refresh-status are the writers.
  const loadDrift = useCallback(async () => {
    if (!currentOrganizationId) {
      setDrift(null);
      return;
    }
    const { data } = await supabase
      .from('connect_account_drift_events')
      .select('observed_account_id, expected_account_id, source, detected_at')
      .eq('organization_id', currentOrganizationId)
      .is('resolved_at', null)
      .order('detected_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      setDrift(null);
      return;
    }
    const row = data as {
      observed_account_id: string;
      expected_account_id: string | null;
      source: 'webhook' | 'refresh-status' | 'manual';
      detected_at: string;
    };
    setDrift({
      observed_account_id: row.observed_account_id,
      expected_account_id: row.expected_account_id,
      source: row.source,
      detected_at: row.detected_at,
    });
  }, [currentOrganizationId]);

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
    // Re-pull the mirrored row + drift state regardless — the route just updated both.
    await Promise.all([loadStatus(), loadDrift()]);
  }, [currentOrganizationId, loadStatus, loadDrift]);

  // Load mirrored status + drift whenever the org becomes available / changes.
  useEffect(() => {
    if (!enabled) {
      setStatusLoading(false);
      return;
    }
    void loadStatus();
    void loadDrift();
  }, [enabled, loadStatus, loadDrift]);

  // Drift events are written by the account.updated webhook + refresh-status and
  // the nightly reconcile cron. Subscribe so the drift banner appears/clears live
  // for owner/admin without a manual refresh. RLS scopes events to the org.
  useSupabaseRealtimeSync({
    channelName: `connect_drift:${currentOrganizationId ?? ''}`,
    table: 'connect_account_drift_events',
    filter: currentOrganizationId ? `organization_id=eq.${currentOrganizationId}` : undefined,
    enabled: enabled && !!currentOrganizationId,
    onEvent: () => {
      void loadDrift();
      void loadStatus();
    },
  });

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

  return { enabled, connectInstance, initError, loading, status, statusLoading, drift, refreshStatus };
}
