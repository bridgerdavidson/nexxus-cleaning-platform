'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import {
  deriveActionReason,
  ACTION_REASON_PRIORITY,
  type ActionReason,
} from '../lib/appointments/actionReason';

export interface AdminActionItem {
  id: string;
  reason: ActionReason;
  organization_id: string;
  homeowner_id: string;
  cleaner_id: string | null;
  property_id: string;
  service_type_id: string;
  duration_minutes: number;
  status: string;
  request_state: string | null;
  cleaner_confirmation_status: 'awaiting' | 'approved' | 'rejected' | null;
  total_price: number;
  scheduled_date: string;
  scheduled_time: string;
  response_deadline: string | null;
  created_at: string;
  property: { name: string; address: string; city: string; state: string } | null;
  service_type: { name: string; base_price: number } | null;
  homeowner: {
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
  } | null;
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
  latest_feedback: {
    id: string;
    reason: string | null;
    suggested_times: Array<{ id: string; suggested_date: string; suggested_time: string }>;
    suggested_windows: Array<{ id: string; window_date: string; start_time: string; end_time: string }>;
  } | null;
}

type FlatRecord = Record<string, unknown> | undefined | null;

const flatten1 = <T>(v: T | T[] | null | undefined): T | null => {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
};

/**
 * The unified admin "action items" feed.
 *
 * Replaces the trio of useAdminPendingRequests (homeowner requests waiting
 * for assignment) + the BookingsPage `rescheduleRequiredAppointments` memo
 * (rejected/overdue) + the admin overview `needsResponseCount` memo. Same
 * data drives the admin overview, the Bookings tab, and the nav-dot count.
 *
 * Each item carries a computed `reason` (see ActionReason) so the UI can
 * group/render appropriately.
 */
export function useAdminActionItems() {
  const { currentOrganizationId, accessToken } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.appointments.actionItemsByOrg(orgId);
  const autoDeferFiredRef = useRef(false);

  const query = useOrgQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(
          `id, organization_id, homeowner_id, cleaner_id, property_id, service_type_id,
           duration_minutes, status, request_state, cleaner_confirmation_status,
           total_price, scheduled_date, scheduled_time, response_deadline, created_at,
           property:properties(name, address, city, state),
           service_type:service_types(name, base_price),
           homeowner:user_profiles!homeowner_id(first_name, last_name, email, phone),
           cleaner_profile:cleaner_profiles(id, user_profile:user_profiles!id(first_name, last_name)),
           appointment_requested_slots(slot_index, scheduled_date, scheduled_time),
           appointment_routing_log(cleaner_id, attempt_index, response, deadline_at, decline_reason, responded_at),
           cleaner_availability_feedback(id, reason, cleaner_suggested_times(id, suggested_date, suggested_time), cleaner_suggested_windows(id, window_date, start_time, end_time))`,
        )
        .eq('organization_id', orgId)
        // Server-side prefilter: anything that could be action-required has
        // one of these signals. We compute the precise reason client-side
        // since `isAppointmentOverdue` and `has_suggestions` need derived
        // logic, but this keeps the result set bounded.
        .or(
          [
            'request_state.eq.awaiting_admin',
            'request_state.eq.needs_admin_attention',
            'cleaner_confirmation_status.eq.rejected',
            'cleaner_confirmation_status.eq.awaiting',
          ].join(','),
        )
        .not('status', 'in', '(cancelled,completed)')
        .order('scheduled_date', { ascending: true });

      if (error) throw error;

      const now = new Date();
      const items: AdminActionItem[] = [];
      for (const row of (data ?? []) as FlatRecord[]) {
        if (!row) continue;
        const r = row as Record<string, unknown>;

        const feedbackRaw = flatten1(r.cleaner_availability_feedback as never) as FlatRecord;
        const suggestedTimes =
          (feedbackRaw?.cleaner_suggested_times as Array<{ id: string; suggested_date: string; suggested_time: string }>) ?? [];
        const suggestedWindows =
          (feedbackRaw?.cleaner_suggested_windows as Array<{ id: string; window_date: string; start_time: string; end_time: string }>) ?? [];
        const has_suggestions = suggestedTimes.length > 0 || suggestedWindows.length > 0;

        const reason = deriveActionReason(
          {
            status: r.status as string,
            request_state: (r.request_state as string | null) ?? null,
            cleaner_confirmation_status: (r.cleaner_confirmation_status as string | null) ?? null,
            cleaner_id: (r.cleaner_id as string | null) ?? null,
            response_deadline: (r.response_deadline as string | null) ?? null,
            has_suggestions,
          },
          now,
        );
        if (!reason) continue;

        const cleanerProfile = flatten1(r.cleaner_profile as never) as FlatRecord;
        const cleanerUserProfile = cleanerProfile
          ? (flatten1(cleanerProfile.user_profile as never) as {
              first_name: string | null;
              last_name: string | null;
            } | null)
          : null;

        items.push({
          id: r.id as string,
          reason,
          organization_id: r.organization_id as string,
          homeowner_id: r.homeowner_id as string,
          cleaner_id: (r.cleaner_id as string | null) ?? null,
          property_id: r.property_id as string,
          service_type_id: r.service_type_id as string,
          duration_minutes: r.duration_minutes as number,
          status: r.status as string,
          request_state: (r.request_state as string | null) ?? null,
          cleaner_confirmation_status:
            (r.cleaner_confirmation_status as 'awaiting' | 'approved' | 'rejected' | null) ?? null,
          total_price: (r.total_price as number) ?? 0,
          scheduled_date: r.scheduled_date as string,
          scheduled_time: r.scheduled_time as string,
          response_deadline: (r.response_deadline as string | null) ?? null,
          created_at: r.created_at as string,
          property: flatten1(r.property as never) as AdminActionItem['property'],
          service_type: flatten1(r.service_type as never) as AdminActionItem['service_type'],
          homeowner: flatten1(r.homeowner as never) as AdminActionItem['homeowner'],
          current_cleaner: cleanerProfile
            ? {
                id: cleanerProfile.id as string,
                user_profile: cleanerUserProfile,
              }
            : null,
          requested_slots: (
            (r.appointment_requested_slots as Array<{
              slot_index: number;
              scheduled_date: string;
              scheduled_time: string;
            }>) ?? []
          )
            .slice()
            .sort((a, b) => a.slot_index - b.slot_index),
          routing_log: (
            (r.appointment_routing_log as Array<{
              cleaner_id: string;
              attempt_index: number;
              response: string;
              deadline_at: string;
              decline_reason: string | null;
              responded_at: string | null;
            }>) ?? []
          )
            .slice()
            .sort((a, b) => a.attempt_index - b.attempt_index),
          latest_feedback: feedbackRaw
            ? {
                id: feedbackRaw.id as string,
                reason: (feedbackRaw.reason as string | null) ?? null,
                suggested_times: suggestedTimes,
                suggested_windows: suggestedWindows,
              }
            : null,
        });
      }
      return items;
    },
  });

  // Opportunistic auto-defer sweep on first load — pg_cron is the primary
  // sweep mechanism (Phase 5) but firing here too catches the case where the
  // admin opens the page right after a deadline passes.
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
    channelName: `admin_action_items_appts:${orgId}`,
    table: 'appointments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });
  useSupabaseRealtimeSync({
    channelName: `admin_action_items_routing:${orgId}`,
    table: 'appointment_routing_log',
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });
  useSupabaseRealtimeSync({
    channelName: `admin_action_items_feedback:${orgId}`,
    table: 'cleaner_availability_feedback',
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const items = query.data ?? [];

  const groupedByReason = useMemo(() => {
    const groups: Record<ActionReason, AdminActionItem[]> = {
      counter_proposed: [],
      all_cleaners_declined: [],
      cleaner_overdue: [],
      cleaner_declined: [],
      awaiting_assignment: [],
    };
    for (const item of items) {
      groups[item.reason].push(item);
    }
    return groups;
  }, [items]);

  const orderedGroups = useMemo(() => {
    return ACTION_REASON_PRIORITY.map((reason) => ({
      reason,
      items: groupedByReason[reason],
    })).filter((g) => g.items.length > 0);
  }, [groupedByReason]);

  const assignCleaner = useMutation({
    mutationFn: async (args: { appointmentId: string; cleanerId: string; forceAssign?: boolean }) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch('/api/appointments/assign-cleaner', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          appointmentId: args.appointmentId,
          cleanerId: args.cleanerId,
          organizationId: orgId,
          forceAssign: args.forceAssign ?? false,
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

  const acceptCounterProposal = useMutation({
    mutationFn: async (args: { appointmentId: string; suggestedTimeId: string }) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch('/api/appointments/accept-counter-proposal', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          appointmentId: args.appointmentId,
          suggestedTimeId: args.suggestedTimeId,
          organizationId: orgId,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to accept counter-proposal');
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    items,
    groupedByReason,
    orderedGroups,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    assignCleaner: assignCleaner.mutateAsync,
    assigning: assignCleaner.isPending,
    acceptCounterProposal: acceptCounterProposal.mutateAsync,
    acceptingCounterProposal: acceptCounterProposal.isPending,
  };
}
