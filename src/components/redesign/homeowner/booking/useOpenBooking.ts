'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { replaceSearchShallow } from '@/lib/shallowSearch';

export function bookingParams(opts?: { serviceTypeId?: string; propertyId?: string }): Record<string, string> {
  const p: Record<string, string> = { book: '1' };
  if (opts?.serviceTypeId) p.bookService = opts.serviceTypeId;
  if (opts?.propertyId) p.bookProperty = opts.propertyId;
  return p;
}

/**
 * Open the "Request a cleaning" flow by setting `?book=1` on the current path (plus an
 * optional `&bookService=` / `&bookProperty=` prefill). Shallow in-place URL update;
 * reads no search params, so callers need no Suspense boundary (mirrors useOpenCleaning).
 */
export function useOpenBooking(): (opts?: { serviceTypeId?: string; propertyId?: string }) => void {
  const pathname = usePathname();
  return useCallback(
    (opts) => {
      const qs = new URLSearchParams(bookingParams(opts)).toString();
      replaceSearchShallow(`${pathname}?${qs}`);
    },
    [pathname],
  );
}
