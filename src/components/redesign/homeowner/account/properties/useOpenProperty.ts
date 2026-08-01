'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { replaceSearchShallow } from '@/lib/shallowSearch';

/** Open the property-detail takeover by setting `?property=<id>` on the current
 * path (shallow, no scroll). Reads no search params, so no Suspense needed. */
export function useOpenProperty(): (id: string) => void {
  const pathname = usePathname();
  return useCallback(
    (id: string) => replaceSearchShallow(`${pathname}?property=${id}`),
    [pathname],
  );
}
