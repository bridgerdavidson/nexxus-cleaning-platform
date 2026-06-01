'use client';

import { useEffect } from 'react';
import { useQuery, type UseQueryOptions, type QueryKey } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AUTH_DEBUG, authDebug } from './authDebug';

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
  const { user, currentOrganizationId, accessToken, orgStatus } = useAuth();
  const ready = !!user && !!currentOrganizationId && !!accessToken;
  const callerEnabled = options.enabled ?? true;

  // Smoking-gun signal for the blank-dashboard bug: a query disabled because the
  // org id is null even though the user is authenticated. Distinguishes "org id
  // null disabled the query" from "the query ran and errored".
  useEffect(() => {
    if (!AUTH_DEBUG) return;
    if (!ready && !!user && !!accessToken && !currentOrganizationId) {
      authDebug('orgquery-disabled', { orgStatus });
    }
  }, [ready, user, accessToken, currentOrganizationId, orgStatus]);

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
