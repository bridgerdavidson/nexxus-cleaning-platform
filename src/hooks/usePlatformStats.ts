'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { keys } from '../lib/queryKeys';
import { platformFetch } from '../lib/platform/fetch';
import type { PlatformStats } from '../types/platform';

/** Platform-wide overview metrics (tenants, plans, platform fees, GMV, appointments). */
export function usePlatformStats() {
  const { accessToken, isPlatformAdmin } = useAuth();
  return useQuery({
    queryKey: keys.platform.stats,
    queryFn: async () => {
      const { stats } = await platformFetch<{ stats: PlatformStats }>(
        '/api/platform/stats',
        accessToken as string,
      );
      return stats;
    },
    enabled: !!accessToken && isPlatformAdmin === true,
  });
}
