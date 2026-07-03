'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export interface OwnerProperty {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

/**
 * Properties belonging to a chosen customer (org-scoped). When `ownerId` is null (self-pay,
 * org-owned), fetches the org's own properties instead (owner is any staff / org-owned rows).
 */
export function usePropertiesByOwner(ownerId: string | null) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? null;

  const query = useQuery({
    queryKey: ['operator-booking', 'properties-by-owner', orgId ?? 'none', ownerId ?? 'org'],
    enabled: !!orgId,
    queryFn: async (): Promise<OwnerProperty[]> => {
      let q = supabase
        .from('properties')
        .select('id, name, address, city, state')
        .eq('organization_id', orgId as string)
        .order('name', { ascending: true });
      if (ownerId) q = q.eq('owner_id', ownerId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OwnerProperty[];
    },
  });

  return { properties: query.data ?? [], loading: query.isLoading };
}
