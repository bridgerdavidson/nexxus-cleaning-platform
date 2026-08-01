'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { replaceSearchShallow } from '@/lib/shallowSearch';

/** Open the service-detail takeover by setting `?service=<id>` on the current path. */
export function useOpenService(): (id: string) => void {
  const pathname = usePathname();
  return useCallback(
    (id: string) => replaceSearchShallow(`${pathname}?service=${id}`),
    [pathname],
  );
}
