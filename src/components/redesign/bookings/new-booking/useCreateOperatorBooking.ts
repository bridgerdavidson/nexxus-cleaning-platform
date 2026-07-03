'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { computeResponseDeadlineISO } from '@/lib/computeResponseDeadline';
import type { ServiceType } from '@/hooks/useServices';
import { buildBookingInsert } from './buildBookingInsert';
import type { OperatorBookingState } from './operator-booking-types';

/**
 * Create a single operator booking: inserts the appointment (pending, awaiting the offered
 * cleaner's response) + its offered slots, mirroring the legacy AddAppointmentModal. Uses the
 * anon RLS client (org staff are allowed to insert org appointments) , no new route/schema.
 * On success invalidates the org appointments so the booking appears in the list.
 */
export function useCreateOperatorBooking() {
  const { currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      state,
      service,
    }: {
      state: OperatorBookingState;
      service: ServiceType;
    }): Promise<string> => {
      if (!currentOrganizationId) throw new Error('No organization');
      const primary = state.slots[0];
      const deadline = computeResponseDeadlineISO(primary.date, primary.time);
      const { appointment, slots } = buildBookingInsert(
        currentOrganizationId,
        state,
        service,
        deadline,
      );

      const { data, error } = await supabase
        .from('appointments')
        .insert(appointment)
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message || 'Could not create the booking');
      const appointmentId = (data as { id: string }).id;

      // Offered slots are non-fatal: the appointment already carries the primary time.
      const slotRows = slots.map((sl) => ({ appointment_id: appointmentId, ...sl }));
      await supabase.from('appointment_requested_slots').insert(slotRows);

      return appointmentId;
    },
    onSuccess: () => {
      if (currentOrganizationId) {
        queryClient.invalidateQueries({ queryKey: keys.appointments.byOrg(currentOrganizationId) });
      }
    },
  });

  return { create: mutation.mutateAsync, creating: mutation.isPending };
}
