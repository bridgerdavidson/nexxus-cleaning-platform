'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';
import { platformFetch } from '../lib/platform/fetch';
import type { PlatformAuditEntry } from '../types/platform';

interface AuditPage {
  entries: PlatformAuditEntry[];
  nextOffset: number | null;
}

/**
 * Platform audit trail, paginated for load-more. Pass `orgId` to scope to one
 * tenant (the tenant sheet's recent-activity list); omit for the global log.
 * Consumers read `data.pages.flatMap(p => p.entries)` and drive `fetchNextPage`
 * off `hasNextPage`.
 */
export function usePlatformAudit(params: { orgId?: string | null; limit?: number } = {}) {
  const { accessToken, isPlatformAdmin } = useAuth();
  const orgId = params.orgId ?? null;
  const limit = params.limit ?? 50;

  return useInfiniteQuery({
    queryKey: keys.platform.audit({ orgId, limit }),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(limit), offset: String(pageParam) });
      if (orgId) qs.set('org_id', orgId);
      return platformFetch<AuditPage>(
        `/api/platform/audit?${qs.toString()}`,
        accessToken as string,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!accessToken && isPlatformAdmin === true,
  });
}
