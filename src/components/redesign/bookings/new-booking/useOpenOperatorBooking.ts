'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export function operatorBookingParams(prefill?: { date?: string; time?: string }): Record<string, string> {
  const params: Record<string, string> = { newbooking: '1' };
  if (prefill?.date) params.date = prefill.date;
  if (prefill?.time) params.time = prefill.time;
  return params;
}

/**
 * Open the operator new-booking sheet by setting `?newbooking=1` on the current path.
 * Uses router.replace (no scroll); reads no search params, so callers need no Suspense
 * boundary (mirrors the homeowner useOpenBooking).
 */
export function useOpenOperatorBooking(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    const qs = new URLSearchParams(operatorBookingParams()).toString();
    router.replace(`${pathname}?${qs}`, { scroll: false });
  }, [router, pathname]);
}
