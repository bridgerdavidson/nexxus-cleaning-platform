"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

const MESSAGES_PATH = "/cleaner/messages";

/**
 * Open the cleaner's office thread takeover via URL params:
 * - `openConversation(convId)`         -> `?thread=<convId>` (an existing thread, e.g. an inbox row)
 * - `openWith(userId)`                 -> `?to=<userId>` (start/open a thread with a specific office person)
 * - `openThreadFromJob(userId, jobId)` -> `?to=<userId>&appointment=<jobId>&from=<jobId>`
 *   (from the active-job "Message office" sheet: stage the job + enable a "Back to job" return)
 * On the Messages page we replace (no history spam); from elsewhere we push to navigate there.
 * Reads no search params, so callers need no Suspense boundary (matches useOpenJob).
 */
export function useOpenOfficeThread() {
  const router = useRouter();
  const pathname = usePathname();

  const go = useCallback(
    (qs: string) => {
      const url = `${MESSAGES_PATH}?${qs}`;
      if (pathname === MESSAGES_PATH) router.replace(url, { scroll: false });
      else router.push(url);
    },
    [router, pathname],
  );

  const openConversation = useCallback((conversationId: string) => go(`thread=${conversationId}`), [go]);
  const openWith = useCallback((userId: string) => go(`to=${userId}`), [go]);
  // From the active-job "Message office" sheet: open a thread with the chosen person,
  // stage the job (&appointment=), and mark its origin (&from=) so the thread's back
  // button returns to that active job ("Back to job").
  const openThreadFromJob = useCallback(
    (userId: string, jobId: string) => go(`to=${userId}&appointment=${jobId}&from=${jobId}`),
    [go],
  );

  return { openConversation, openWith, openThreadFromJob };
}
