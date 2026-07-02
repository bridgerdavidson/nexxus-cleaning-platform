'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { sortPaymentMethods, type SavedPaymentMethod } from './derive-payment-methods';

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
 * The authenticated homeowner's own saved payment methods (self-scoped
 * `/api/stripe/my-payment-methods`). Returns the sorted list (default first) plus
 * set-default / remove actions that invalidate the cache on success. All three verbs
 * derive the Stripe customer from the bearer token server-side, so a caller can only
 * ever touch their own cards.
 */
export function useSavedPaymentMethods() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: keys.paymentMethods.byUser(userId ?? 'none'),
    enabled: !!userId,
    queryFn: async (): Promise<SavedPaymentMethod[]> => {
      const res = await authedFetch('/api/stripe/my-payment-methods');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load your payment methods');
      return (data.cards ?? []) as SavedPaymentMethod[];
    },
  });

  const invalidate = () =>
    userId ? queryClient.invalidateQueries({ queryKey: keys.paymentMethods.byUser(userId) }) : Promise.resolve();

  async function mutate(method: 'PATCH' | 'DELETE', paymentMethodId: string) {
    const res = await authedFetch('/api/stripe/my-payment-methods', {
      method,
      body: JSON.stringify({ payment_method_id: paymentMethodId }),
    });
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
