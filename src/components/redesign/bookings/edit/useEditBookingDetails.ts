'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import type { DetailsPatchBody } from './buildDetailsPatch';

/**
 * Mutation hook for the Edit-details form. Calls PATCH
 * /api/appointments/[appointmentId]/details. Errors are tagged with
 * { stale?, paidGuard? } for the form's error handling, same shape as
 * useRescheduleBooking's { conflict?, stale? }. On success invalidates both
 * the org appointments and action-items keys (siblings that do not cascade).
 */
export function useEditBookingDetails(appointmentId: string) {
  const { currentOrganizationId, accessToken } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (body: DetailsPatchBody) => {
      if (!accessToken) {
        throw Object.assign(new Error('Not authenticated'), { stale: false, paidGuard: false });
      }

      const res = await fetch(`/api/appointments/${appointmentId}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ organizationId: currentOrganizationId, ...body }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        const error = Object.assign(new Error(json?.error || 'Could not save changes'), {
          stale: !!json?.stale,
          paidGuard: !!json?.paidGuard,
        });
        throw error;
      }

      return json as { success: true };
    },
    onSuccess: () => {
      if (currentOrganizationId) {
        // Sibling keys: byOrg does NOT cascade to action items.
        queryClient.invalidateQueries({ queryKey: keys.appointments.byOrg(currentOrganizationId) });
        queryClient.invalidateQueries({
          queryKey: keys.appointments.actionItemsByOrg(currentOrganizationId),
        });
      }
    },
  });

  return { save: mutation.mutateAsync, saving: mutation.isPending };
}
