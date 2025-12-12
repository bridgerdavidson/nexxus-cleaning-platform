'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { ManagerPermissions } from './useAdminData';

export function useManagerPermissions() {
  const [permissions, setPermissions] = useState<ManagerPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchPermissions = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) {
      setPermissions(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log('Fetching permissions for manager:', user.id, 'org:', currentOrganizationId);
      const { data, error: fetchError } = await supabase
        .from('manager_permissions')
        .select('can_view_customers, can_edit_customers, can_view_bookings, can_edit_bookings, can_manage_cleaners, can_view_properties, can_edit_properties, can_view_analytics, can_view_payments, can_manage_payments, can_view_messages')
        .eq('manager_id', user.id)
        .eq('organization_id', currentOrganizationId)
        .single();
      
      console.log('Query result - data:', data, 'error:', fetchError);

      if (fetchError) {
        // If no permissions found, set all to false
        if (fetchError.code === 'PGRST116') {
          console.warn('No manager_permissions record found for manager:', user.id);
          setPermissions({
            can_view_customers: false,
            can_edit_customers: false,
            can_view_bookings: false,
            can_edit_bookings: false,
            can_manage_cleaners: false,
            can_view_properties: false,
            can_edit_properties: false,
            can_view_analytics: false,
            can_view_payments: false,
            can_manage_payments: false,
            can_view_messages: false,
          });
        } else {
          console.error('Error fetching manager permissions:', fetchError);
          throw fetchError;
        }
      } else if (data) {
        console.log('Manager permissions loaded from DB:', data);
        // Use explicit boolean conversion to handle null/undefined values
        setPermissions({
          can_view_customers: Boolean(data.can_view_customers),
          can_edit_customers: Boolean(data.can_edit_customers),
          can_view_bookings: Boolean(data.can_view_bookings),
          can_edit_bookings: Boolean(data.can_edit_bookings),
          can_manage_cleaners: Boolean(data.can_manage_cleaners),
          can_view_properties: Boolean(data.can_view_properties),
          can_edit_properties: Boolean(data.can_edit_properties),
          can_view_analytics: Boolean(data.can_view_analytics),
          can_view_payments: Boolean(data.can_view_payments),
          can_manage_payments: Boolean(data.can_manage_payments),
          can_view_messages: Boolean(data.can_view_messages),
        });
        console.log('Manager permissions after conversion:', {
          can_view_customers: Boolean(data.can_view_customers),
          can_edit_customers: Boolean(data.can_edit_customers),
          can_view_bookings: Boolean(data.can_view_bookings),
          can_edit_bookings: Boolean(data.can_edit_bookings),
          can_manage_cleaners: Boolean(data.can_manage_cleaners),
          can_view_properties: Boolean(data.can_view_properties),
          can_edit_properties: Boolean(data.can_edit_properties),
          can_view_analytics: Boolean(data.can_view_analytics),
          can_view_payments: Boolean(data.can_view_payments),
          can_manage_payments: Boolean(data.can_manage_payments),
          can_view_messages: Boolean(data.can_view_messages),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch permissions');
      // Set default permissions (all false) on error
      setPermissions({
        can_view_customers: false,
        can_edit_customers: false,
        can_view_bookings: false,
        can_edit_bookings: false,
        can_manage_cleaners: false,
        can_view_properties: false,
        can_edit_properties: false,
        can_view_analytics: false,
        can_view_payments: false,
        can_manage_payments: false,
        can_view_messages: false,
      });
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const refetch = useCallback(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  return { permissions, loading, error, refetch };
}

