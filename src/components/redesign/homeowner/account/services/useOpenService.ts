'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Open the service-detail takeover by setting `?service=<id>` on the current path. */
export function useOpenService(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (id: string) => router.replace(`${pathname}?service=${id}`, { scroll: false }),
    [router, pathname],
  );
}
