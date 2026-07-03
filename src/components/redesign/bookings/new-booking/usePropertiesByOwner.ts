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
  /** Null when the property is owned by the organization (no homeowner). */
  owner_id: string | null;
  /** The homeowner who owns it (null for org-owned rows). */
  owner: { first_name: string | null; last_name: string | null } | null;
}

function flattenOwner(v: unknown): OwnerProperty['owner'] {
  if (!v) return null;
  const o = Array.isArray(v) ? v[0] : v;
  return (o as OwnerProperty['owner']) ?? null;
}

/**
 * Properties for the booking flow (org-scoped). When `ownerId` is set (customer-billed), returns that
 * customer's homes. When null (self-pay), returns every org property , including the homeowner owner
 * (or null owner_id for company-owned rows) so the picker can label them.
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
        .select('id, name, address, city, state, owner_id, owner:user_profiles!owner_id(first_name, last_name)')
        .eq('organization_id', orgId as string)
        .order('name', { ascending: true });
      if (ownerId) q = q.eq('owner_id', ownerId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r.id as string,
          name: (r.name as string) ?? null,
          address: (r.address as string) ?? null,
          city: (r.city as string) ?? null,
          state: (r.state as string) ?? null,
          owner_id: (r.owner_id as string) ?? null,
          owner: flattenOwner(r.owner),
        };
      });
    },
  });

  return { properties: query.data ?? [], loading: query.isLoading };
}
