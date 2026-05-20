'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { ManagerPermissions } from './useAdminData';

const ALL_FALSE: ManagerPermissions = {
  can_view_customers: false,
  can_edit_customers: false,
  can_view_bookings: false,
  can_edit_bookings: false,
  can_approve_decline_bookings: false,
  can_manage_cleaners: false,
  can_view_properties: false,
  can_edit_properties: false,
  can_view_analytics: false,
  can_view_payments: false,
  can_manage_payments: false,
  can_view_messages: false,
  can_view_services: false,
  can_manage_services: false,
  can_handle_requests: false,
};

export function useManagerPermissions() {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const orgId = currentOrganizationId ?? '';
  const queryKey = keys.managerPermissions.byUser(userId);

  const query = useQuery({
    queryKey,
    enabled: !!user?.id && !!currentOrganizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manager_permissions')
        .select('can_view_customers, can_edit_customers, can_view_bookings, can_edit_bookings, can_approve_decline_bookings, can_manage_cleaners, can_view_properties, can_edit_properties, can_view_analytics, can_view_payments, can_manage_payments, can_view_messages, can_view_services, can_manage_services, can_handle_requests')
        .eq('manager_id', userId)
        .eq('organization_id', orgId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return ALL_FALSE;
        }
        throw error;
      }

      return {
        can_view_customers: Boolean(data.can_view_customers),
        can_edit_customers: Boolean(data.can_edit_customers),
        can_view_bookings: Boolean(data.can_view_bookings),
        can_edit_bookings: Boolean(data.can_edit_bookings),
        can_approve_decline_bookings: Boolean(data.can_approve_decline_bookings),
        can_manage_cleaners: Boolean(data.can_manage_cleaners),
        can_view_properties: Boolean(data.can_view_properties),
        can_edit_properties: Boolean(data.can_edit_properties),
        can_view_analytics: Boolean(data.can_view_analytics),
        can_view_payments: Boolean(data.can_view_payments),
        can_manage_payments: Boolean(data.can_manage_payments),
        can_view_messages: Boolean(data.can_view_messages),
        can_view_services: Boolean(data.can_view_services),
        can_manage_services: Boolean(data.can_manage_services),
        can_handle_requests: Boolean(data.can_handle_requests),
      } as ManagerPermissions;
    },
  });

  // Live permissions — if an admin grants or revokes a flag, the manager's
  // sidebar/UI gates flip without requiring a sign-out / reload.
  useSupabaseRealtimeSync({
    channelName: `manager_permissions:user:${userId}`,
    table: 'manager_permissions',
    filter: userId ? `manager_id=eq.${userId}` : undefined,
    enabled: !!userId && !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  return {
    permissions: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
