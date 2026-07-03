'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import type { ServiceType } from '@/hooks/useServices';
import { buildBookingInsert } from './buildBookingInsert';
import { buildRecurringPayload } from './buildRecurringPayload';
import { isRecurring } from './deriveRecurrence';
import type { OperatorBookingState } from './operator-booking-types';

export interface CreateBookingResult {
  recurring: boolean;
  count: number;
}

/**
 * Create an operator booking. A one-time booking inserts an `appointments` row (+ offered slots) via
 * the anon RLS client, mirroring the legacy AddAppointmentModal. A recurring booking (customer-billed
 * only) POSTs to the existing /api/recurring-appointments with a Bearer token; the route enforces
 * org membership + role and generates the series. No new route/schema.
 * On success invalidates the org appointments so the booking(s) appear in the list.
 */
export function useCreateOperatorBooking() {
  const { currentOrganizationId, accessToken } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      state,
      service,
    }: {
      state: OperatorBookingState;
      service: ServiceType;
    }): Promise<CreateBookingResult> => {
      if (!currentOrganizationId) throw new Error('No organization');

      if (isRecurring(state)) {
        if (!accessToken) throw new Error('Not authenticated');
        const payload = buildRecurringPayload(currentOrganizationId, state, service);
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
      const { appointment, slots } = buildBookingInsert(currentOrganizationId, state, service, deadline);

      const { data, error } = await supabase
        .from('appointments')
        .insert(appointment)
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message || 'Could not create the booking');
      const appointmentId = (data as { id: string }).id;

      // Offered slots (primary + alternates) are recorded only when the operator offered
      // alternates; a lone primary is already the appointment's date/time. Non-fatal.
      if (slots.length > 1) {
        const slotRows = slots.map((sl) => ({ appointment_id: appointmentId, ...sl }));
        await supabase.from('appointment_requested_slots').insert(slotRows);
      }

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
