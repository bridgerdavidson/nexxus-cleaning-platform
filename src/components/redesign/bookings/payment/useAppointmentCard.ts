'use client';

import { useQuery } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { keys } from '@/lib/queryKeys';
import { sortPaymentMethods, type SavedPaymentMethod } from '@/components/redesign/shared/payment-methods/derive-payment-methods';

/**
 * The homeowner's saved cards for an appointment, plus the specific card attached
 * to it (matched by payment_method_id). Uses the staff route (owner/admin/manager).
 * Powers both the "card on file" display and the Change-card picker.
 */
export function useAppointmentCard(args: {
  appointmentId: string;
  homeownerId: string | null;
  organizationId: string | null;
  paymentMethodId: string | null;
  enabled?: boolean;
}) {
  const { homeownerId, organizationId, paymentMethodId, enabled = true } = args;
  const query = useQuery({
    queryKey: keys.paymentMethods.byAppointmentHomeowner(organizationId ?? 'none', homeownerId ?? 'none'),
    enabled: enabled && !!homeownerId && !!organizationId,
    queryFn: async (): Promise<SavedPaymentMethod[]> => {
      const token = await getAccessToken();
      const params = new URLSearchParams({ homeowner_id: homeownerId!, organization_id: organizationId! });
      const res = await fetch(`/api/stripe/saved-payment-methods?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the card on file');
      return (data.cards ?? []) as SavedPaymentMethod[];
    },
  });
  const cards = sortPaymentMethods(query.data ?? []);
  const card = cards.find((c) => c.id === paymentMethodId) ?? null;
  return { card, cards, loading: query.isLoading, error: query.isError, refetch: query.refetch };
}
