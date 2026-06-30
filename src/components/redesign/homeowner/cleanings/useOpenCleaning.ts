'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Open the cleaning-detail takeover by setting `?appointment=<id>` on the
 * current path. Uses router.replace (no scroll) so closing restores list state;
 * reads no search params, so callers need no Suspense boundary (matches useOpenJob). */
export function useOpenCleaning(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (id: string) => router.replace(`${pathname}?appointment=${id}`, { scroll: false }),
    [router, pathname],
  );
}
