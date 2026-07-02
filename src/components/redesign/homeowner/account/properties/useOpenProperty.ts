'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Open the property-detail takeover by setting `?property=<id>` on the current
 * path (router.replace, no scroll). Reads no search params, so no Suspense needed. */
export function useOpenProperty(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (id: string) => router.replace(`${pathname}?property=${id}`, { scroll: false }),
    [router, pathname],
  );
}
