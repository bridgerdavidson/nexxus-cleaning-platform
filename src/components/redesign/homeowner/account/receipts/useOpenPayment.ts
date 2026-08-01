'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { replaceSearchShallow } from '@/lib/shallowSearch';

/** Open the receipt takeover by setting `?payment=<id>` on the current path. */
export function useOpenPayment(): (id: string) => void {
  const pathname = usePathname();
  return useCallback(
    (id: string) => replaceSearchShallow(`${pathname}?payment=${id}`),
    [pathname],
  );
}
