'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';

export interface AdminPendingRequest {
  id: string;
  homeowner_id: string;
  cleaner_id: string | null;
  property_id: string;
  service_type_id: string;
  duration_minutes: number;
  status: string;
  request_state: string;
  total_price: number;
  response_deadline: string | null;
  created_at: string;
  property: { name: string; address: string; city: string; state: string } | null;
  service_type: { name: string; base_price: number } | null;
  homeowner: { first_name: string | null; last_name: string | null; email: string } | null;
  current_cleaner: {
    id: string;
    user_profile: { first_name: string | null; last_name: string | null } | null;
  } | null;
  requested_slots: Array<{ slot_index: number; scheduled_date: string; scheduled_time: string }>;
  routing_log: Array<{
    cleaner_id: string;
    attempt_index: number;
    response: string;
    deadline_at: string;
    decline_reason: string | null;
    responded_at: string | null;
  }>;
}

interface RawRow {
  id: string;
  homeowner_id: string;
  cleaner_id: string | null;
  property_id: string;
  service_type_id: string;
  duration_minutes: number;
  status: string;
  request_state: string;
  total_price: number;
  response_deadline: string | null;
  created_at: string;
  property: { name: string; address: string; city: string; state: string }
    | { name: string; address: string; city: string; state: string }[]
    | null;
  service_type: { name: string; base_price: number }
    | { name: string; base_price: number }[]
    | null;
  homeowner: { first_name: string | null; last_name: string | null; email: string }
    | { first_name: string | null; last_name: string | null; email: string }[]
    | null;
  cleaner_profile: {
    id: string;
    user_profile: { first_name: string | null; last_name: string | null }
      | { first_name: string | null; last_name: string | null }[]
      | null;
  } | { id: string; user_profile: unknown }[] | null;
  appointment_requested_slots: Array<{ slot_index: number; scheduled_date: string; scheduled_time: string }>;
  appointment_routing_log: Array<{
    cleaner_id: string;
    attempt_index: number;
    response: string;
    deadline_at: string;
    decline_reason: string | null;
    responded_at: string | null;
  }>;
}

const flatten1 = <T>(v: T | T[] | null | undefined): T | null => {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
};

export function useAdminPendingRequests() {
  const { currentOrganizationId, accessToken } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.appointments.requestsByOrg(orgId);
  const autoDeferFiredRef = useRef(false);

  const query = useOrgQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(
          `id, homeowner_id, cleaner_id, property_id, service_type_id, duration_minutes,
           status, request_state, total_price, response_deadline, created_at,
           cleaner_confirmation_status,
           property:properties(name, address, city, state),
           service_type:service_types(name, base_price),
           homeowner:user_profiles!homeowner_id(first_name, last_name, email),
           cleaner_profile:cleaner_profiles(id, user_profile:user_profiles!id(first_name, last_name)),
           appointment_requested_slots(slot_index, scheduled_date, scheduled_time),
           appointment_routing_log(cleaner_id, attempt_index, response, deadline_at, decline_reason, responded_at)`,
        )
        .eq('organization_id', orgId)
        .eq('homeowner_initiated', true)
        // Once admin assigns a cleaner the row transitions to 'routing' and is
        // handled by AwaitingApprovalSection (cleaner_confirmation_status='awaiting').
        // Awaiting-requests only surfaces what needs the admin's attention.
        // We also exclude rejected rows — when the chain exhausts, the
        // appointment lands in RescheduleRequiredSection ("All cleaners
        // declined" variant) and shouldn't duplicate here.
        .in('request_state', ['awaiting_admin', 'needs_admin_attention'])
        .neq('cleaner_confirmation_status', 'rejected')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row): AdminPendingRequest => {
        const r = row as unknown as RawRow;
        const cleanerProfile = flatten1(r.cleaner_profile) as
          | { id: string; user_profile: unknown }
          | null;
        const userProfile = cleanerProfile
          ? (flatten1(cleanerProfile.user_profile as
              | { first_name: string | null; last_name: string | null }
              | { first_name: string | null; last_name: string | null }[]
              | null) as { first_name: string | null; last_name: string | null } | null)
          : null;
        return {
          id: r.id,
          homeowner_id: r.homeowner_id,
          cleaner_id: r.cleaner_id,
          property_id: r.property_id,
          service_type_id: r.service_type_id,
          duration_minutes: r.duration_minutes,
          status: r.status,
          request_state: r.request_state,
          total_price: r.total_price,
          response_deadline: r.response_deadline,
          created_at: r.created_at,
          property: flatten1(r.property),
          service_type: flatten1(r.service_type),
          homeowner: flatten1(r.homeowner),
          current_cleaner: cleanerProfile
            ? { id: cleanerProfile.id, user_profile: userProfile }
            : null,
          requested_slots: (r.appointment_requested_slots ?? []).slice().sort(
            (a, b) => a.slot_index - b.slot_index,
          ),
          routing_log: (r.appointment_routing_log ?? []).slice().sort(
            (a, b) => a.attempt_index - b.attempt_index,
          ),
        };
      });
    },
  });

  // Opportunistic auto-defer sweep on first load — mirrors the "derived on
  // read" pattern from migration 058.
  useEffect(() => {
    if (!orgId || !accessToken || autoDeferFiredRef.current) return;
    autoDeferFiredRef.current = true;
    fetch('/api/appointments/auto-defer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ organizationId: orgId }),
    }).catch(() => undefined);
  }, [orgId, accessToken]);

  useSupabaseRealtimeSync({
    channelName: `admin_pending_requests_appts:${orgId}`,
    table: 'appointments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });
  useSupabaseRealtimeSync({
    channelName: `admin_pending_requests_routing:${orgId}`,
    table: 'appointment_routing_log',
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const assignCleaner = useMutation({
    mutationFn: async (args: { appointmentId: string; cleanerId: string }) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch('/api/appointments/assign-cleaner', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          appointmentId: args.appointmentId,
          cleanerId: args.cleanerId,
          organizationId: orgId,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to assign cleaner');
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    requests: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    assignCleaner: assignCleaner.mutateAsync,
    assigning: assignCleaner.isPending,
  };
}
