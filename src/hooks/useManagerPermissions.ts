'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
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
};

export function useManagerPermissions() {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const orgId = currentOrganizationId ?? '';

  const query = useQuery({
    queryKey: keys.managerPermissions.byUser(userId),
    enabled: !!user?.id && !!currentOrganizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manager_permissions')
        .select('can_view_customers, can_edit_customers, can_view_bookings, can_edit_bookings, can_approve_decline_bookings, can_manage_cleaners, can_view_properties, can_edit_properties, can_view_analytics, can_view_payments, can_manage_payments, can_view_messages, can_view_services, can_manage_services')
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
      } as ManagerPermissions;
    },
  });

  return {
    permissions: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
