'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from '../lib/queryKeys';
import type { AppointmentCardData } from '../components/AppointmentCard';

// Admin-shaped select (a superset of the cleaner/homeowner shapes) so the result
// can populate the side panel for any role. RLS still scopes what the caller can
// read, so a user only ever resolves their own appointments.
const SELECT = `
  id, organization_id, service_type_id, checklist_id, scheduled_date, scheduled_time,
  duration_minutes, status, job_progress, total_price, authorization_status,
  special_requests, notes, series_id, cleaner_confirmation_status, response_deadline,
  price_override_enabled, price_override_total, homeowner_id, is_self_pay, cleaner_id,
  homeowner:user_profiles!homeowner_id(first_name, last_name, email, phone),
  cleaner_profile:cleaner_profiles(user_profile:user_profiles!id(id, first_name, last_name, email)),
  property:properties(name, address, city, state),
  service_type:service_types(name, description),
  checklist:checklists(name, price_adder),
  cleaner_availability_feedback (
    id, reason,
    cleaner_suggested_times ( id, suggested_date, suggested_time ),
    cleaner_suggested_windows ( id, window_date, start_time, end_time )
  )
`;

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Fetch a single appointment by id in AppointmentCardData shape. Used as the
 * fallback for the notification deep-link: when a clicked notification's
 * appointment isn't in the currently loaded list (filtered/paginated away), the
 * panel host fetches it by id so the drawer still opens. Disabled when no id is
 * passed, so it costs nothing on the common in-list path.
 */
export function useAppointmentById(appointmentId?: string | null) {
  return useQuery({
    queryKey: appointmentId
      ? keys.appointments.detail(appointmentId)
      : keys.appointments.detail('none'),
    enabled: !!appointmentId,
    queryFn: async (): Promise<AppointmentCardData | null> => {
      const { data, error } = await supabase
        .from('appointments')
        .select(SELECT)
        .eq('id', appointmentId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        ...row,
        homeowner: unwrap(row.homeowner),
        cleaner_profile: unwrap(row.cleaner_profile),
        property: unwrap(row.property),
        service_type: unwrap(row.service_type),
        checklist: unwrap(row.checklist),
      } as unknown as AppointmentCardData;
    },
  });
}
