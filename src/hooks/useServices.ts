'use client';

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { createServiceApi, deleteServiceApi, updateServiceApi } from './services-api';
import type { ChecklistSeed } from '@/lib/catalog/serviceInput';

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
  const res = await createServiceApi({
    organization_id: organizationId,
    name: data.name,
    description: data.description ?? null,
    base_price: data.base_price,
    duration_minutes: data.duration_minutes,
    service_type: data.service_type,
    is_active: data.is_active ?? true,
  });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

// Update an existing service. The route resolves the service's org and checks the
// caller's role there, so a wrong-org or missing service reads as "not found".
export async function updateService(
  serviceId: string,
  data: UpdateServiceData
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  const res = await updateServiceApi(serviceId, data);
  if (res.success) return { success: true, data: res.data };
  if (res.status === 404 || res.status === 403) {
    return { success: false, error: "Service not found or you don't have permission to update it." };
  }
  return { success: false, error: res.error };
}

// Delete a service. The route refuses with 409 while appointments or series use it.
export async function deleteService(
  serviceId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await deleteServiceApi(serviceId);
  return res.success ? { success: true } : { success: false, error: res.error };
}

// Toggle service active status.
export async function toggleServiceActive(
  serviceId: string,
  isActive: boolean
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  return updateService(serviceId, { is_active: isActive });
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

// Order line items the way useChecklists renders them: position asc, NULLs last,
// created_at as the tiebreaker.
function sortLineItems<T extends { position: number | null; created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.position === null && b.position === null) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    if (a.position !== b.position) return a.position - b.position;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

// Duplicate a service, cloning all of its checklists + line items. The source is
// read here (reads stay direct); the clone is created by POST /api/services with
// `checklists`, which drops the trigger-seeded default and copies these instead,
// and which deletes the clone again if any checklist fails to copy.
export async function duplicateService(
  organizationId: string,
  serviceId: string
): Promise<{ success: boolean; data?: ServiceType; error?: string }> {
  const { data: source, error: srcError } = await supabase
    .from('service_types')
    .select('*')
    .eq('id', serviceId)
    .eq('organization_id', organizationId)
    .single();
  if (srcError || !source) {
    return { success: false, error: srcError?.message ?? 'Service not found' };
  }
  const src = source as ServiceType;

  const { data: srcChecklists, error: clError } = await supabase
    .from('checklists')
    .select('*, checklist_line_items (*)')
    .eq('service_type_id', serviceId);
  if (clError) return { success: false, error: clError.message };

  const checklists: ChecklistSeed[] = ((srcChecklists ?? []) as ChecklistWithItemsRow[]).map((cl) => ({
    name: cl.name,
    price_adder: Number(cl.price_adder) || 0,
    position: cl.position,
    items: sortLineItems(cl.checklist_line_items ?? []).map((it) => it.task),
  }));

  const res = await createServiceApi({
    organization_id: organizationId,
    name: `${src.name} (copy)`,
    description: src.description,
    base_price: Number(src.base_price),
    duration_minutes: src.duration_minutes,
    service_type: src.service_type,
    is_active: src.is_active,
    checklists,
  });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}
