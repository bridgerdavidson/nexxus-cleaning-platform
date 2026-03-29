'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useRealtimeServices } from './useRealtimeServices';

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
  const [services, setServices] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchServices = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) {
      setServices([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('service_types')
        .select('*')
        .eq('organization_id', currentOrganizationId)
        .order('name', { ascending: true });

      if (fetchError) {
        throw fetchError;
      }

      setServices(data || []);
    } catch (err) {
      console.error('Error fetching services:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch services');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  // Realtime callback: Handle new service INSERT (receives full row from realtime payload)
  const handleServiceInsert = useCallback((service: ServiceType) => {
    // Add to state, maintaining alphabetical order by name
    setServices((prev) => {
      // Check if already exists to avoid duplicates
      if (prev.some((s) => s.id === service.id)) {
        return prev;
      }
      const updated = [...prev, service];
      return updated.sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  // Realtime callback: Handle service UPDATE (receives full row from realtime payload)
  const handleServiceUpdate = useCallback((service: ServiceType) => {
    setServices((prev) => {
      const updated = prev.map((s) =>
        s.id === service.id ? service : s
      );
      // Re-sort in case name changed
      return updated.sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  // Realtime callback: Handle service DELETE
  const handleServiceDelete = useCallback((serviceId: string) => {
    setServices((prev) => prev.filter((s) => s.id !== serviceId));
  }, []);

  // Set up realtime subscription
  useRealtimeServices({
    organizationId: currentOrganizationId || '',
    onInsert: handleServiceInsert,
    onUpdate: handleServiceUpdate,
    onDelete: handleServiceDelete,
    enabled: !!currentOrganizationId,
  });

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const refetch = useCallback(() => {
    fetchServices();
  }, [fetchServices]);

  // Update a single service in state (merge partial fields)
  const updateServiceInState = useCallback(
    (serviceId: string, patch: Partial<ServiceType>) => {
      setServices((prev) => {
        const updated = prev.map((s) =>
          s.id === serviceId ? { ...s, ...patch } : s
        );
        // Re-sort if name changed
        if (patch.name !== undefined) {
          return updated.sort((a, b) => a.name.localeCompare(b.name));
        }
        return updated;
      });
    },
    []
  );

  // Replace a single service in state (full replacement)
  const replaceServiceInState = useCallback((service: ServiceType) => {
    setServices((prev) => {
      const updated = prev.map((s) => (s.id === service.id ? service : s));
      return updated.sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  // ── Checklist price-adder map (persists across tab switches) ──────────
  const [maxChecklistAdderByServiceId, setMaxChecklistAdderByServiceId] =
    useState<Record<string, number>>({});

  const serviceIdsKey = useMemo(
    () => [...services].map((s) => s.id).sort().join(','),
    [services]
  );

  const fetchMaxChecklistAdders = useCallback(async () => {
    if (!currentOrganizationId) {
      setMaxChecklistAdderByServiceId({});
      return;
    }
    const ids = serviceIdsKey ? serviceIdsKey.split(',') : [];
    if (ids.length === 0) {
      setMaxChecklistAdderByServiceId({});
      return;
    }

    try {
      const { data, error: qError } = await supabase
        .from('checklists')
        .select('service_type_id, price_adder')
        .in('service_type_id', ids);

      if (qError) {
        throw qError;
      }

      const map: Record<string, number> = {};
      for (const id of ids) {
        map[id] = 0;
      }
      for (const row of data || []) {
        const sid = row.service_type_id as string;
        const adder = Number(row.price_adder) || 0;
        map[sid] = Math.max(map[sid] ?? 0, adder);
      }
      setMaxChecklistAdderByServiceId(map);
    } catch (e) {
      console.error('Error loading checklist adders for services:', e);
    }
  }, [currentOrganizationId, serviceIdsKey]);

  useEffect(() => {
    fetchMaxChecklistAdders();
  }, [fetchMaxChecklistAdders]);

  return {
    services,
    loading,
    error,
    refetch,
    setServices,
    updateServiceInState,
    replaceServiceInState,
    maxChecklistAdderByServiceId,
    refreshMaxChecklistAdders: fetchMaxChecklistAdders,
  };
}

export function useService(serviceId: string | null) {
  const [service, setService] = useState<ServiceType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchService = useCallback(async () => {
    if (!user?.id || !currentOrganizationId || !serviceId) {
      setService(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('service_types')
        .select('*')
        .eq('id', serviceId)
        .eq('organization_id', currentOrganizationId)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      setService(data);
    } catch (err) {
      console.error('Error fetching service:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch service');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId, serviceId]);

  useEffect(() => {
    fetchService();
  }, [fetchService]);

  return { service, loading, error, refetch: fetchService };
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
