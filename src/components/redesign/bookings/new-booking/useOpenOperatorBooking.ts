'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export function operatorBookingParams(): Record<string, string> {
  return { newbooking: '1' };
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
