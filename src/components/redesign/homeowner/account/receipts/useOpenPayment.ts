'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Open the receipt takeover by setting `?payment=<id>` on the current path. */
export function useOpenPayment(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (id: string) => router.replace(`${pathname}?payment=${id}`, { scroll: false }),
    [router, pathname],
  );
}
