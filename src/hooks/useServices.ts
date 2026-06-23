'use client';

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';

export interface ServiceType {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
  service_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateServiceData {
  name: string;
  description?: string | null;
  base_price: number;
  duration_minutes: number;
  service_type: string;
  is_active?: boolean;
}

export interface UpdateServiceData {
  name?: string;
  description?: string | null;
  base_price?: number;
  duration_minutes?: number;
  service_type?: string;
  is_active?: boolean;
}

export function useServices() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.services.byOrg(orgId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('service_types')
        .select('*')
        .eq('organization_id', orgId)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ServiceType[];
    },
  });

  const services = useMemo(() => query.data ?? [], [query.data]);

  // Realtime: full-row payload patches the cache directly. No refetch needed.
  useSupabaseRealtimeSync({
    channelName: `services:${orgId}`,
    table: 'service_types',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: (payload) => {
      const event = payload.eventType;
      if (event === 'INSERT' || event === 'UPDATE') {
        const row = payload.new as unknown as ServiceType;
        return {
          type: 'patch',
          key: queryKey,
          updater: (old) => {
            const list = Array.isArray(old) ? (old as ServiceType[]) : [];
            const next = list.some(s => s.id === row.id)
              ? list.map(s => (s.id === row.id ? row : s))
              : [...list, row];
            return next.sort((a, b) => a.name.localeCompare(b.name));
          },
        };
      }
      if (event === 'DELETE') {
        const old = payload.old as unknown as { id: string };
        return {
          type: 'patch',
          key: queryKey,
          updater: (prev) => {
            const list = Array.isArray(prev) ? (prev as ServiceType[]) : [];
            return list.filter(s => s.id !== old.id);
          },
        };
      }
    },
  });

  const updateServiceInState = useCallback(
    (serviceId: string, patch: Partial<ServiceType>) => {
      queryClient.setQueryData<ServiceType[]>(queryKey, prev => {
        const list = prev ?? [];
        const updated = list.map(s => (s.id === serviceId ? { ...s, ...patch } : s));
        if (patch.name !== undefined) {
          return updated.sort((a, b) => a.name.localeCompare(b.name));
        }
        return updated;
      });
    },
    [queryClient, queryKey]
  );

  const replaceServiceInState = useCallback(
    (service: ServiceType) => {
      queryClient.setQueryData<ServiceType[]>(queryKey, prev => {
        const list = prev ?? [];
        const updated = list.map(s => (s.id === service.id ? service : s));
        return updated.sort((a, b) => a.name.localeCompare(b.name));
      });
    },
    [queryClient, queryKey]
  );

  const setServices = useCallback(
    (
      updater:
        | ServiceType[]
        | ((prev: ServiceType[]) => ServiceType[])
    ) => {
      queryClient.setQueryData<ServiceType[]>(queryKey, prev => {
        const list = prev ?? [];
        return typeof updater === 'function' ? (updater as (p: ServiceType[]) => ServiceType[])(list) : updater;
      });
    },
    [queryClient, queryKey]
  );

  // Checklist max-price-adder map — derived from the services list.
  const serviceIdsKey = useMemo(
    () => [...services].map(s => s.id).sort().join(','),
    [services]
  );

  const adderQueryKey = useMemo(
    () => ['services', 'max-checklist-adder', orgId, serviceIdsKey] as const,
    [orgId, serviceIdsKey]
  );

  const adderQuery = useOrgQuery({
    queryKey: adderQueryKey,
    enabled: !!orgId && serviceIdsKey.length > 0,
    queryFn: async () => {
      const ids = serviceIdsKey ? serviceIdsKey.split(',') : [];
      if (ids.length === 0) return {} as Record<string, number>;

      const { data, error } = await supabase
        .from('checklists')
        .select('service_type_id, price_adder')
        .in('service_type_id', ids);
      if (error) throw error;

      const map: Record<string, number> = {};
      for (const id of ids) map[id] = 0;
      for (const row of data ?? []) {
        const sid = row.service_type_id as string;
        const adder = Number(row.price_adder) || 0;
        map[sid] = Math.max(map[sid] ?? 0, adder);
      }
      return map;
    },
  });

  const refreshMaxChecklistAdders = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: adderQueryKey });
  }, [queryClient, adderQueryKey]);

  return {
    services,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    setServices,
    updateServiceInState,
    replaceServiceInState,
    maxChecklistAdderByServiceId: adderQuery.data ?? {},
    refreshMaxChecklistAdders,
  };
}

export function useService(serviceId: string | null) {
  const query = useOrgQuery({
    queryKey: keys.services.detail(serviceId ?? ''),
    enabled: !!serviceId,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('service_types')
        .select('*')
        .eq('id', serviceId as string)
        .eq('organization_id', orgId)
        .single();
      if (error) throw error;
      return data as ServiceType;
    },
  });

  return {
    service: query.data ?? null,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

// Create a new service
export async function createService(
  organizationId: string,
  data: CreateServiceData
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  try {
    const { data: newService, error } = await supabase
      .from('service_types')
      .insert({
        organization_id: organizationId,
        name: data.name,
        description: data.description || null,
        base_price: data.base_price,
        duration_minutes: data.duration_minutes,
        service_type: data.service_type,
        is_active: data.is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return { success: true, data: newService };
  } catch (err) {
    console.error('Error creating service:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create service',
    };
  }
}

// Update an existing service.
// When organizationId is provided, the update is scoped to that org (avoids PGRST116 from wrong scope/RLS).
// Uses .maybeSingle() so 0 rows return a clear error instead of PostgREST PGRST116.
export async function updateService(
  serviceId: string,
  data: UpdateServiceData,
  organizationId?: string
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  try {
    const updatePayload = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.base_price !== undefined && { base_price: data.base_price }),
      ...(data.duration_minutes !== undefined && { duration_minutes: data.duration_minutes }),
      ...(data.service_type !== undefined && { service_type: data.service_type }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    };

    let query = supabase
      .from('service_types')
      .update(updatePayload)
      .eq('id', serviceId);
    if (organizationId != null) {
      query = query.eq('organization_id', organizationId);
    }
    const { data: updatedService, error } = await query.select().maybeSingle();

    if (error) {
      // PGRST116 = 0 rows; show same friendly message as null result
      const code = (error as { code?: string })?.code;
      if (code === 'PGRST116') {
        return {
          success: false,
          error: 'Service not found or you don\'t have permission to update it.',
        };
      }
      throw error;
    }

    if (updatedService == null) {
      return {
        success: false,
        error: 'Service not found or you don\'t have permission to update it.',
      };
    }

    return { success: true, data: updatedService };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'PGRST116') {
      return {
        success: false,
        error: 'Service not found or you don\'t have permission to update it.',
      };
    }
    console.error('Error updating service:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update service',
    };
  }
}

// Delete a service
export async function deleteService(
  serviceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // First check if service is used in any appointments
    const { data: appointments, error: checkError } = await supabase
      .from('appointments')
      .select('id')
      .eq('service_type_id', serviceId)
      .limit(1);

    if (checkError) {
      throw checkError;
    }

    if (appointments && appointments.length > 0) {
      return {
        success: false,
        error: 'Cannot delete service that is used in existing appointments. Consider disabling it instead.',
      };
    }

    // Also check recurring appointment series
    const { data: series, error: seriesCheckError } = await supabase
      .from('recurring_appointment_series')
      .select('id')
      .eq('service_type_id', serviceId)
      .limit(1);

    if (seriesCheckError) {
      throw seriesCheckError;
    }

    if (series && series.length > 0) {
      return {
        success: false,
        error: 'Cannot delete service that is used in recurring appointment series. Consider disabling it instead.',
      };
    }

    const { error } = await supabase
      .from('service_types')
      .delete()
      .eq('id', serviceId);

    if (error) {
      throw error;
    }

    return { success: true };
  } catch (err) {
    console.error('Error deleting service:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete service',
    };
  }
}

// Toggle service active status. Pass organizationId when available to scope the update.
export async function toggleServiceActive(
  serviceId: string,
  isActive: boolean,
  organizationId?: string
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  return updateService(serviceId, { is_active: isActive }, organizationId);
}

// Check if a service can be deleted (not used in appointments)
export async function canDeleteService(
  serviceId: string
): Promise<{ canDelete: boolean; appointmentCount: number; seriesCount: number }> {
  try {
    // Check appointments
    const { count: appointmentCount, error: appointmentError } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('service_type_id', serviceId);

    if (appointmentError) {
      throw appointmentError;
    }

    // Check recurring series
    const { count: seriesCount, error: seriesError } = await supabase
      .from('recurring_appointment_series')
      .select('id', { count: 'exact', head: true })
      .eq('service_type_id', serviceId);

    if (seriesError) {
      throw seriesError;
    }

    return {
      canDelete: (appointmentCount ?? 0) === 0 && (seriesCount ?? 0) === 0,
      appointmentCount: appointmentCount ?? 0,
      seriesCount: seriesCount ?? 0,
    };
  } catch (err) {
    console.error('Error checking if service can be deleted:', err);
    return { canDelete: false, appointmentCount: -1, seriesCount: -1 };
  }
}

// Local row shape for the duplicate query (checklists + nested line items).
type ChecklistWithItemsRow = {
  id: string;
  name: string;
  price_adder: number;
  position: number | null;
  checklist_line_items: { id: string; task: string; position: number | null; created_at: string }[] | null;
};

// Duplicate a service, cloning all of its checklists + line items.
// GOTCHA: inserting a service_type fires the create_default_checklist_for_service
// trigger, which seeds a "Default Checklist". We delete that auto-seeded checklist
// before copying the source's real checklists, so the clone is an exact copy.
export async function duplicateService(
  organizationId: string,
  serviceId: string
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  // Track the clone so a mid-copy failure doesn't leave an orphaned, partial
  // service in the list (best-effort cleanup in the catch; cascade removes its
  // checklists + items).
  let createdServiceId: string | null = null;
  try {
    const { data: source, error: srcError } = await supabase
      .from('service_types')
      .select('*')
      .eq('id', serviceId)
      .eq('organization_id', organizationId)
      .single();
    if (srcError) throw srcError;
    const src = source as ServiceType;

    // 1. Clone the service row (fires the default-checklist trigger).
    const { data: created, error: createError } = await supabase
      .from('service_types')
      .insert({
        organization_id: organizationId,
        name: `${src.name} (copy)`,
        description: src.description,
        base_price: src.base_price,
        duration_minutes: src.duration_minutes,
        service_type: src.service_type,
        is_active: src.is_active,
      })
      .select()
      .single();
    if (createError) throw createError;
    const newService = created as ServiceType;
    createdServiceId = newService.id;

    // 2. Remove the trigger-seeded "Default Checklist" so we copy only the source's.
    const { error: delError } = await supabase
      .from('checklists')
      .delete()
      .eq('service_type_id', newService.id);
    if (delError) throw delError;

    // 3. Copy the source's checklists + their line items, preserving order.
    const { data: srcChecklists, error: clError } = await supabase
      .from('checklists')
      .select('*, checklist_line_items (*)')
      .eq('service_type_id', serviceId);
    if (clError) throw clError;

    for (const cl of (srcChecklists ?? []) as ChecklistWithItemsRow[]) {
      const { data: newCl, error: insClError } = await supabase
        .from('checklists')
        .insert({
          service_type_id: newService.id,
          name: cl.name,
          price_adder: cl.price_adder,
          position: cl.position,
        })
        .select()
        .single();
      if (insClError) throw insClError;

      // Preserve order: position asc, NULLs last with created_at as the
      // tiebreaker (matches useChecklists/duplicateChecklist), so NULL-position
      // items (e.g. default-checklist tasks) keep their order in the copy.
      const items = [...(cl.checklist_line_items ?? [])].sort((a, b) => {
        if (a.position === null && b.position === null) {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        }
        if (a.position === null) return 1;
        if (b.position === null) return -1;
        if (a.position !== b.position) return a.position - b.position;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      if (items.length > 0) {
        const { error: insItemsError } = await supabase
          .from('checklist_line_items')
          .insert(items.map((it, idx) => ({ checklist_id: newCl.id, task: it.task, position: idx })));
        if (insItemsError) throw insItemsError;
      }
    }

    return { success: true, data: newService };
  } catch (err) {
    console.error('Error duplicating service:', err);
    if (createdServiceId) {
      // Best-effort: drop the partial clone so it doesn't linger in the list.
      try {
        await supabase.from('service_types').delete().eq('id', createdServiceId);
      } catch (cleanupErr) {
        console.error('Error cleaning up partial service duplicate:', cleanupErr);
      }
    }
    return { success: false, error: err instanceof Error ? err.message : 'Failed to duplicate service' };
  }
}
