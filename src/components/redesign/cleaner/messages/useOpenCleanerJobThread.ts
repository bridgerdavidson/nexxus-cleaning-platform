'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { replaceSearchShallow } from '@/lib/shallowSearch';

const MESSAGES_PATH = '/cleaner/messages';

/**
 * Open the cleaner's homeowner<->cleaner JOB thread takeover via `?jobthread=<appointmentId>`
 * (read by CleanerJobThreadHost, mounted in the cleaner layout). On the Messages page we
 * replace in place (shallow, no history spam); from elsewhere we push to navigate there.
 * Reads no search params, so callers need no Suspense boundary (mirrors useOpenOfficeThread).
 */
export function useOpenCleanerJobThread() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (appointmentId: string) => {
      const url = `${MESSAGES_PATH}?jobthread=${appointmentId}`;
      if (pathname === MESSAGES_PATH) replaceSearchShallow(url);
      else router.push(url);
    },
    [router, pathname],
  );
}
