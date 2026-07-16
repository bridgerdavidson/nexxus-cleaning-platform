'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Open/close the tenant-detail sheet via `?tenant=<id>` on the current path.
 * Mirrors useOpenProperty: reads the current query string from window.location
 * inside each handler (never during render) so callers need no Suspense boundary,
 * and uses router.replace (no scroll) so closing restores the roster's scroll +
 * filters. The tenant sheet is read-only, so there is no edit variant.
 */
export function useOpenTenant(): { open: (id: string) => void; close: () => void } {
  const router = useRouter();
  const pathname = usePathname();

  const open = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.set('tenant', id);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const close = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.delete('tenant');
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname]);

  return { open, close };
}
