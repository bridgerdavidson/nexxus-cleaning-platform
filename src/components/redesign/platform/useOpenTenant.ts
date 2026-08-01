'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { replaceSearchShallow } from '@/lib/shallowSearch';

/**
 * Open/close the tenant-detail sheet via `?tenant=<id>` on the current path.
 * Mirrors useOpenProperty: reads the current query string from window.location
 * inside each handler (never during render) so callers need no Suspense boundary,
 * and updates the URL shallowly in place (no scroll) so closing restores the
 * roster's scroll + filters. The tenant sheet is read-only, so there is no edit
 * variant.
 */
export function useOpenTenant(): { open: (id: string) => void; close: () => void } {
  const pathname = usePathname();

  const open = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.set('tenant', id);
      replaceSearchShallow(`${pathname}?${sp.toString()}`);
    },
    [pathname],
  );

  const close = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.delete('tenant');
    const qs = sp.toString();
    replaceSearchShallow(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname]);

  return { open, close };
}
