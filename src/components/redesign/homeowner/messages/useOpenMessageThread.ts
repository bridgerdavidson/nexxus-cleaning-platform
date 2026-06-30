'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Open a homeowner message thread by setting URL params on the CURRENT path, so
 * the thread takeover (mounted in the layout) opens over whatever view is showing
 * (inbox or a cleaning detail). Mirrors useOpenCleaning's set-param-and-replace.
 * - openOffice(userId)       -> ?to=<userId>     (start/open the office thread)
 * - openOfficeThread(convId) -> ?thread=<convId> (open an existing office row)
 * - openJob(appointmentId)   -> ?job=<appointmentId>
 */
export function useOpenMessageThread() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const set = useCallback(
    (key: 'to' | 'thread' | 'job', value: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete('to');
      sp.delete('thread');
      sp.delete('job');
      sp.set(key, value);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return {
    openOffice: useCallback((userId: string) => set('to', userId), [set]),
    openOfficeThread: useCallback((convId: string) => set('thread', convId), [set]),
    openJob: useCallback((appointmentId: string) => set('job', appointmentId), [set]),
  };
}
