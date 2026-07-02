'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import type { BookingState } from './booking-types';

/** Map the flow's state to the `/api/appointments/request` payload (slots -> scheduled_*). */
export function toRequestPayload(orgId: string, s: BookingState) {
  return {
    organizationId: orgId,
    propertyId: s.propertyId!,
    serviceTypeId: s.serviceTypeId!,
    slots: s.slots.map((sl) => ({ scheduled_date: sl.date, scheduled_time: sl.time })),
    specialRequests: s.notes.trim() ? s.notes.trim() : null,
    paymentMethodId: s.paymentMethodId ?? null,
  };
}

/**
 * Submit a homeowner cleaning request. Reuses POST /api/appointments/request unchanged
 * (creates a pending homeowner_request appointment + its offered slots). On success the
 * pending-request and appointment lists are invalidated so the request appears immediately.
 */
export function useSubmitBookingRequest() {
  const { user, currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (state: BookingState): Promise<string> => {
      if (!currentOrganizationId) throw new Error('No organization');
      const token = await getAccessToken();
      const res = await fetch('/api/appointments/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(toRequestPayload(currentOrganizationId, state)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not send your request');
      return data.appointmentId as string;
    },
    onSuccess: () => {
      if (!user?.id) return;
      queryClient.invalidateQueries({ queryKey: keys.appointments.requestsByHomeowner(user.id) });
      queryClient.invalidateQueries({ queryKey: keys.appointments.byHomeowner(user.id) });
    },
  });

  return { submit: mutation.mutateAsync, submitting: mutation.isPending };
}
