'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { sortPaymentMethods, type SavedPaymentMethod } from '@/components/redesign/shared/payment-methods/derive-payment-methods';

async function authedFetch(input: string, init?: RequestInit) {
  const token = await getAccessToken();
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * The organization's self-pay company card(s), org-scoped
 * (`/api/stripe/org/saved-payment-methods`). Returns the sorted list (default first) plus
 * set-default / remove actions that invalidate the cache on success. Every verb is gated
 * server-side by `requireOrgPaymentsAuth` (owner/admin, or a manager with `can_manage_payments`),
 * and the org's self-pay Stripe Customer is resolved server-side, so a caller can only ever touch
 * their own organization's cards. Set-default matters here because self-pay completion charges read
 * the Customer's default PaymentMethod.
 */
export function useOrgPaymentMethods() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: keys.paymentMethods.byOrg(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: async (): Promise<SavedPaymentMethod[]> => {
      const params = new URLSearchParams({ organization_id: orgId! });
      const res = await authedFetch(`/api/stripe/org/saved-payment-methods?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the company payment methods');
      return (data.cards ?? []) as SavedPaymentMethod[];
    },
  });

  const invalidate = () =>
    orgId ? queryClient.invalidateQueries({ queryKey: keys.paymentMethods.byOrg(orgId) }) : Promise.resolve();

  async function mutate(method: 'PATCH' | 'DELETE', paymentMethodId: string) {
    if (!orgId) throw new Error('No organization');
    // The org routes take the ids as query params (no body), unlike the homeowner self-scoped route.
    const params = new URLSearchParams({ organization_id: orgId, payment_method_id: paymentMethodId });
    const res = await authedFetch(`/api/stripe/org/saved-payment-methods?${params.toString()}`, { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    await invalidate();
  }

  return {
    cards: sortPaymentMethods(query.data ?? []),
    loading: query.isLoading,
    error: query.isError,
    refetch: invalidate,
    setDefault: (id: string) => mutate('PATCH', id),
    remove: (id: string) => mutate('DELETE', id),
  };
}
