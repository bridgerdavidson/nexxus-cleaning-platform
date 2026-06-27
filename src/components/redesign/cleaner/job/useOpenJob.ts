"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Open the job-detail overlay by setting `?job=<id>` on the current path.
 * Uses router.replace (no scroll) so closing restores list state; reads no
 * search params, so callers do not need a Suspense boundary. */
export function useOpenJob(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((id: string) => router.replace(`${pathname}?job=${id}`, { scroll: false }), [router, pathname]);
}
