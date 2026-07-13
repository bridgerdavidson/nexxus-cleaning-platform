'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** Everything the operator new-booking sheet can be seeded with via `?newbooking=1&...`. */
export type NewBookingSeed = {
  date?: string;
  time?: string;
  customerId?: string;
  propertyId?: string;
  billTo?: 'customer' | 'self_pay';
};

export function operatorBookingParams(seed?: NewBookingSeed): Record<string, string> {
  const params: Record<string, string> = { newbooking: '1' };
  if (seed?.date) params.date = seed.date;
  if (seed?.time) params.time = seed.time;
  if (seed?.customerId) params.customerId = seed.customerId;
  if (seed?.propertyId) params.propertyId = seed.propertyId;
  if (seed?.billTo) params.billTo = seed.billTo;
  return params;
}

/**
 * Open the operator new-booking sheet by setting `?newbooking=1` (plus any seed fields)
 * on the current path. Uses router.replace (no scroll); reads no search params itself, so
 * callers need no Suspense boundary (mirrors the homeowner useOpenBooking).
 *
 * Some callers (OperatorTopBar, OperatorMobileNav) wire this directly as a bare `onClick`
 * handler, so the returned callback's first argument may be a React synthetic event rather
 * than a seed. Only treat the argument as a seed if it isn't a synthetic event.
 */
export function useOpenOperatorBooking(): (seed?: NewBookingSeed) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (seed?: NewBookingSeed) => {
      const safe = seed && typeof seed === 'object' && !('nativeEvent' in seed) ? seed : undefined;
      const qs = new URLSearchParams(operatorBookingParams(safe)).toString();
      router.replace(`${pathname}?${qs}`, { scroll: false });
    },
    [router, pathname],
  );
}
