'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';

/**
 * Mutation hook for the reschedule flow. Calls POST /api/appointments/[appointmentId]/reschedule
 * with the new date, time, and optional cleaner assignment. Errors are tagged with
 * { conflict?, stale? } for dialog error handling. On success, invalidates both
 * the org appointments and action-items keys (siblings that do not cascade).
 */
export function useRescheduleBooking(appointmentId: string) {
  const { currentOrganizationId, accessToken } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (body: {
      scheduledDate: string;
      scheduledTime: string;
      cleanerId: string | null;
      force?: boolean;
    }) => {
      if (!accessToken) {
        throw Object.assign(new Error('Not authenticated'), { conflict: false, stale: false });
      }

      const res = await fetch(`/api/appointments/${appointmentId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ organizationId: currentOrganizationId, ...body }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        const error = Object.assign(new Error(json?.error || 'Could not reschedule'), {
          conflict: !!json?.conflict,
          stale: !!json?.stale,
        });
        throw error;
      }

      return json as { success: true; outcome: 'settled' | 'awaiting' };
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

  return { reschedule: mutation.mutateAsync, saving: mutation.isPending };
}
