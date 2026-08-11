'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import { keys } from '@/lib/queryKeys';

export interface CancelMyCleaningResult {
  fee_outcome?: 'charged' | 'uncollectable' | 'failed' | 'retry_in_progress';
  fee_captured_cents?: number;
  fee_message?: string;
  fee_payment_id?: string;
}

/**
 * Homeowner-initiated cancel of their own cleaning. POSTs the shared cancel route as the
 * owning homeowner; the route forces party='homeowner' / no_show=false server-side, so we
 * only send the org id (and an optional reason). On success it invalidates the homeowner
 * appointments + stats so the Cleanings list and detail reflect the cancellation.
 */
export function useCancelMyCleaning() {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ appointmentId, reason }: { appointmentId: string; reason?: string }) => {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // party/no_show are forced server-side for a homeowner caller; we send org id only.
        body: JSON.stringify({ organization_id: currentOrganizationId, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.details || 'Cancellation failed');
      return data as CancelMyCleaningResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.appointments.byHomeowner(userId) });
      queryClient.invalidateQueries({ queryKey: keys.stats.homeowner(userId) });
    },
  });

  return {
    cancel: (appointmentId: string, reason?: string) => mutation.mutateAsync({ appointmentId, reason }),
    isPending: mutation.isPending,
  };
}
