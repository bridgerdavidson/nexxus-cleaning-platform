'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Read and write a single URL query param used to deep-link a detail view open
 * (e.g. `?customer=<id>`). Returns the current value and a setter that updates
 * the URL in place (router.replace, no scroll). A `null` value removes the param.
 *
 * Pattern in a container: seed the detail state from `paramId` in an effect (so
 * a deep-link opens the detail), and call `setParam(id)` / `setParam(null)` from
 * the open / close handlers so the URL stays in sync and a closed detail does not
 * reopen on refresh.
 */
export function useDetailParam(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramId = searchParams.get(key);

  const setParam = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [key, router, pathname, searchParams],
  );

  return { paramId, setParam };
}
