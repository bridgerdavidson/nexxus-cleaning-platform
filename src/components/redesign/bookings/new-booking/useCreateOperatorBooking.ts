'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import type { ServiceType } from '@/hooks/useServices';
import { createBookingApi } from './bookings-api';
import { buildBookingInsert } from './buildBookingInsert';
import { buildRecurringPayload } from './buildRecurringPayload';
import { isRecurring } from './deriveRecurrence';
import type { OperatorBookingState } from './operator-booking-types';

export interface CreateBookingResult {
  recurring: boolean;
  count: number;
}

/**
 * Create an operator booking. A one-time booking POSTs to /api/appointments (the route resolves and
 * checks every referenced row and inserts the appointment plus offered slots). A recurring booking
 * (customer-billed only) POSTs to /api/recurring-appointments. Both send a Bearer token and the route
 * enforces org membership + role. On success invalidates the org appointments so the booking(s)
 * appear in the list.
 */
export function useCreateOperatorBooking() {
  const { currentOrganizationId, accessToken } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      state,
      service,
      checklist,
    }: {
      state: OperatorBookingState;
      service: ServiceType;
      checklist: { price_adder: number } | null;
    }): Promise<CreateBookingResult> => {
      if (!currentOrganizationId) throw new Error('No organization');

      if (isRecurring(state)) {
        if (!accessToken) throw new Error('Not authenticated');
        const payload = buildRecurringPayload(currentOrganizationId, state, service, checklist);
        const res = await fetch('/api/recurring-appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Could not create the recurring series');
        }
        return { recurring: true, count: json.data?.appointmentsCreated ?? 0 };
      }

      const primary = state.slots[0];
      const deadline = computeResponseDeadlineISO(primary.date, primary.time);
      const { appointment, slots } = buildBookingInsert(currentOrganizationId, state, service, deadline, checklist);

      const res = await createBookingApi({ organization_id: currentOrganizationId, appointment, slots });
      if (!res.success) throw new Error(res.error);
      return { recurring: false, count: 1 };
    },
    onSuccess: () => {
      if (currentOrganizationId) {
        queryClient.invalidateQueries({ queryKey: keys.appointments.byOrg(currentOrganizationId) });
      }
    },
  });

  return { create: mutation.mutateAsync, creating: mutation.isPending };
}
