'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';

export interface HomeownerRequest {
  id: string;
  organization_id: string;
  property_id: string;
  service_type_id: string;
  status: string;
  request_state: string | null;
  scheduled_date: string;
  scheduled_time: string;
  total_price: number;
  created_at: string;
  property: { name: string; address: string; city: string; state: string } | null;
  service_type: { name: string } | null;
  requested_slots: Array<{ slot_index: number; scheduled_date: string; scheduled_time: string }>;
}

interface RequestRow {
  id: string;
  organization_id: string;
  property_id: string;
  service_type_id: string;
  status: string;
  request_state: string | null;
  scheduled_date: string;
  scheduled_time: string;
  total_price: number;
  created_at: string;
  property: { name: string; address: string; city: string; state: string } | { name: string; address: string; city: string; state: string }[] | null;
  service_type: { name: string } | { name: string }[] | null;
  appointment_requested_slots: Array<{ slot_index: number; scheduled_date: string; scheduled_time: string }>;
}

const flatten1 = <T>(v: T | T[] | null | undefined): T | null => {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
};

export function useHomeownerRequests() {
  const { user, currentOrganizationId, accessToken } = useAuth();
  const homeownerId = user?.id ?? '';
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.appointments.requestsByHomeowner(homeownerId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(
          `id, organization_id, property_id, service_type_id, status, request_state, scheduled_date, scheduled_time, total_price, created_at,
           property:properties(name, address, city, state),
           service_type:service_types(name),
           appointment_requested_slots(slot_index, scheduled_date, scheduled_time)`,
        )
        .eq('homeowner_id', homeownerId)
        .eq('organization_id', orgId)
        .eq('homeowner_initiated', true)
        .in('request_state', ['awaiting_admin', 'routing', 'needs_admin_attention'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row): HomeownerRequest => {
        const r = row as unknown as RequestRow;
        return {
          id: r.id,
          organization_id: r.organization_id,
          property_id: r.property_id,
          service_type_id: r.service_type_id,
          status: r.status,
          request_state: r.request_state,
          scheduled_date: r.scheduled_date,
          scheduled_time: r.scheduled_time,
          total_price: r.total_price,
          created_at: r.created_at,
          property: flatten1(r.property),
          service_type: flatten1(r.service_type),
          requested_slots: r.appointment_requested_slots ?? [],
        };
      });
    },
  });

  // Invalidate when the underlying appointment row or slot rows change.
  useSupabaseRealtimeSync({
    channelName: `homeowner_requests:${homeownerId}`,
    table: 'appointments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!homeownerId && !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });
  useSupabaseRealtimeSync({
    channelName: `homeowner_request_slots:${homeownerId}`,
    table: 'appointment_requested_slots',
    enabled: !!homeownerId && !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const cancelRequest = useMutation({
    mutationFn: async (appointmentId: string) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch('/api/appointments/request/cancel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ appointmentId, organizationId: orgId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to cancel request');
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
    cancelRequest: cancelRequest.mutateAsync,
    cancelling: cancelRequest.isPending,
  };
}
