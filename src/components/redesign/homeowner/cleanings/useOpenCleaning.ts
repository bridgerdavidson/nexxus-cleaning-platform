'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { replaceSearchShallow } from '@/lib/shallowSearch';

/** Open the cleaning-detail takeover by setting `?appointment=<id>` on the
 * current path. Shallow in-place URL update so closing restores list state;
 * reads no search params, so callers need no Suspense boundary (matches useOpenJob). */
export function useOpenCleaning(): (id: string) => void {
  const pathname = usePathname();
  return useCallback(
    (id: string) => replaceSearchShallow(`${pathname}?appointment=${id}`),
    [pathname],
  );
}
