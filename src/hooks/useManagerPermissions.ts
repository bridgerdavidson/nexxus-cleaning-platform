'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import {
  MANAGER_FLAG_SELECT,
  coerceManagerPermissions,
  emptyManagerPermissions,
  type ManagerPermissions,
} from '../lib/permissions/managerFlags';

const ALL_FALSE: ManagerPermissions = emptyManagerPermissions();

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
        .select(MANAGER_FLAG_SELECT)
        .eq('manager_id', userId)
        .eq('organization_id', orgId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return ALL_FALSE;
        }
        throw error;
      }

      // The dynamic (non-literal) select string above defeats postgrest-js's
      // type-level column parser, so cast through `unknown` before reading fields.
      return coerceManagerPermissions(data as unknown as Record<string, unknown>);
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
