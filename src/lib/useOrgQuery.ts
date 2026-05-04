'use client';

import { useQuery, type UseQueryOptions, type QueryKey } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

export interface OrgQueryContext {
  orgId: string;
  userId: string;
  accessToken: string;
  signal: AbortSignal;
}

export function useOrgQuery<TData, TKey extends QueryKey = QueryKey>(
  options: Omit<UseQueryOptions<TData, Error, TData, TKey>, 'queryFn' | 'enabled'> & {
    queryFn: (ctx: OrgQueryContext) => Promise<TData>;
    enabled?: boolean;
  }
) {
  const { user, currentOrganizationId, accessToken } = useAuth();
  const ready = !!user && !!currentOrganizationId && !!accessToken;
  const callerEnabled = options.enabled ?? true;

  return useQuery<TData, Error, TData, TKey>({
    ...options,
    enabled: ready && callerEnabled,
    queryFn: ({ signal }) =>
      options.queryFn({
        orgId: currentOrganizationId as string,
        userId: (user as { id: string }).id,
        accessToken: accessToken as string,
        signal,
      }),
  });
}
