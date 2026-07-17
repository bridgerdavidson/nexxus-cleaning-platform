'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';
import { platformFetch } from '../lib/platform/fetch';
import type { PlatformAlert } from '../types/platform';

interface AlertsPage {
  alerts: PlatformAlert[];
  nextOffset: number | null;
}

/**
 * Platform-owner alert outbox, paginated for load-more. `status` is 'open'
 * (default), 'resolved', or 'all'. Consumers read `data.pages.flatMap(p => p.alerts)`
 * and drive `fetchNextPage` off `hasNextPage`.
 */
export function usePlatformAlerts(params: { status?: string; limit?: number } = {}) {
  const { accessToken, isPlatformAdmin } = useAuth();
  const status = params.status ?? 'open';
  const limit = params.limit ?? 50;

  return useInfiniteQuery({
    queryKey: keys.platform.alerts({ status, limit }),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({
        status,
        limit: String(limit),
        offset: String(pageParam),
      });
      return platformFetch<AlertsPage>(
        `/api/platform/alerts?${qs.toString()}`,
        accessToken as string,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !!accessToken && isPlatformAdmin === true,
  });
}

/** Resolve or reopen a platform alert, then refresh every alerts list. */
export function useResolvePlatformAlert() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const res = await fetch(`/api/platform/alerts/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${accessToken as string}`,
        },
        body: JSON.stringify({ resolved }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      return res.json() as Promise<{ ok: true }>;
    },
    onSuccess: () => {
      // Prefix-invalidate every status/limit variant of the alerts list.
      queryClient.invalidateQueries({ queryKey: ['platform', 'alerts'] });
    },
  });
}
