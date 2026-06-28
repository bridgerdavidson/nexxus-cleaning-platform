"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

const MESSAGES_PATH = "/app/cleaner-dashboard/messages";

/**
 * Open the cleaner's office thread takeover via URL params:
 * - `openConversation(convId)` -> `?thread=<convId>` (an existing thread, e.g. an inbox row)
 * - `openWith(userId, appt?)`  -> `?to=<userId>(&appointment=<id>)` (start/open a thread with a
 *   specific office person, e.g. the picker or the active-job "Message office" button)
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
  const openWith = useCallback(
    (userId: string, appointmentId?: string) =>
      go(`to=${userId}${appointmentId ? `&appointment=${appointmentId}` : ""}`),
    [go],
  );

  return { openConversation, openWith };
}
