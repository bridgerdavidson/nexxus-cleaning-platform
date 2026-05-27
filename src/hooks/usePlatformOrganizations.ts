'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';
import type { PlatformOrgDetail, PlatformOrgSummary } from '../types/platform';

async function platformFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** All tenant orgs with member counts (platform-owner oversight). */
export function usePlatformOrganizations() {
  const { accessToken, isPlatformAdmin } = useAuth();
  return useQuery({
    queryKey: keys.platform.organizations.all,
    queryFn: async () => {
      const { organizations } = await platformFetch<{ organizations: PlatformOrgSummary[] }>(
        '/api/platform/organizations',
        accessToken as string,
      );
      return organizations;
    },
    enabled: !!accessToken && isPlatformAdmin === true,
  });
}

/** One tenant org's billing/Connect config + member roster. */
export function usePlatformOrganization(id: string | null) {
  const { accessToken, isPlatformAdmin } = useAuth();
  return useQuery({
    queryKey: keys.platform.organizations.detail(id ?? 'none'),
    queryFn: async () => {
      const { organization } = await platformFetch<{ organization: PlatformOrgDetail }>(
        `/api/platform/organizations/${id}`,
        accessToken as string,
      );
      return organization;
    },
    enabled: !!accessToken && isPlatformAdmin === true && !!id,
  });
}

export interface ProvisionTenantInput {
  name: string;
  owner_email: string;
  billing_email?: string;
}

/** Provision a new tenant org + owner invite; invalidates the org list on success. */
export function useProvisionTenant() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProvisionTenantInput) => {
      const res = await fetch('/api/platform/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.platform.organizations.all });
    },
  });
}
