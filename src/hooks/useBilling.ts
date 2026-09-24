'use client';

import { useAuth } from '@/hooks/useAuth';
import { useOrgQuery } from '@/lib/useOrgQuery';
import { keys } from '@/lib/queryKeys';
import { deriveBillingAccess, type BillingAccess, type OrgBillingRow } from '@/lib/billing/access';
import { billingEnforcementUiEnabled } from '@/lib/billing/flags';
import { fetchBillingState } from '@/components/redesign/billing/billing-api';

export interface UseBillingResult {
  access: BillingAccess | null;
  billing: OrgBillingRow | null;
  seatsInUse: number;
  role: 'owner' | 'admin' | 'manager' | null;
  /** ISO renewal date, or null on a trial. Not part of OrgBillingRow. */
  currentPeriodEnd: string | null;
  isOwner: boolean;
  /** Owner or admin. Managers never see the pill or the pay CTAs (rulings R15/R2). */
  canSeeBillingChrome: boolean;
  uiEnabled: boolean;
  isLoading: boolean;
}

/**
 * The one client read of billing state. Every billing UI surface renders off
 * this hook; nothing else calls fetchBillingState directly.
 *
 * refetchOnWindowFocus is turned ON here, and ONLY here (ruling R19). The
 * global default in src/lib/queryClient.ts is false by design, but a
 * past_due banner that does not self-heal would sit on the customer's screen
 * after they have already paid in the Stripe portal tab. Do not change the
 * global default to fix this; the override belongs on this query alone.
 *
 * Uses useOrgQuery rather than bare useQuery: it forwards arbitrary
 * UseQueryOptions (including refetchOnWindowFocus) through to the underlying
 * useQuery call via a spread, so the local override above still applies, and
 * this stays consistent with every other org-scoped query in the codebase.
 *
 * A 403 (a cleaner who somehow reached this shell) surfaces as `data` staying
 * undefined, so `access` comes back null. Consumers must treat `access ===
 * null` as "render nothing", never as a visible error.
 */
export function useBilling(): UseBillingResult {
  const { currentOrganizationId } = useAuth();
  const uiEnabled = billingEnforcementUiEnabled();
  const orgId = currentOrganizationId ?? '';

  const { data, isLoading } = useOrgQuery({
    queryKey: keys.billing.org(orgId),
    queryFn: ({ orgId }) => fetchBillingState(orgId),
    enabled: uiEnabled,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const billing = data?.billing ?? null;
  const role = data?.role ?? null;

  return {
    access: billing ? deriveBillingAccess(billing, new Date()) : null,
    billing,
    seatsInUse: data?.seats_in_use ?? 0,
    role,
    currentPeriodEnd: data?.current_period_end ?? null,
    isOwner: role === 'owner',
    canSeeBillingChrome: role === 'owner' || role === 'admin',
    uiEnabled,
    isLoading,
  };
}
