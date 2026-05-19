'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface UseVisibilityRefetchOptions {
  // Keys to invalidate (i.e. re-fetch) when the tab regains focus.
  keys: QueryKey[];
  // Skip invalidation when false (e.g. hook is mounted but its source query
  // is `enabled: false`).
  enabled?: boolean;
  // Minimum gap between invalidations, ms. Defaults to 5s so quick alt-tabs
  // don't spam the network.
  minIntervalMs?: number;
}

// Bridges browser visibility back to React Query. Realtime channels can
// silently drop after laptop sleep / wifi flap / ISP NAT eviction without
// supabase-js surfacing the failure, leaving the cache stale. Whenever the
// tab regains focus we invalidate the given keys so the next paint reflects
// reality. Rate-limited to avoid refetch storms on rapid tab toggling.
export function useVisibilityRefetch({
  keys,
  enabled = true,
  minIntervalMs = 5000,
}: UseVisibilityRefetchOptions) {
  const queryClient = useQueryClient();
  const lastRunRef = useRef(0);
  // Hold keys in a ref so the visibility handler always sees the latest set
  // without forcing re-bind of the listener on every render.
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRunRef.current < minIntervalMs) return;
      lastRunRef.current = now;
      for (const key of keysRef.current) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, minIntervalMs, queryClient]);
}
