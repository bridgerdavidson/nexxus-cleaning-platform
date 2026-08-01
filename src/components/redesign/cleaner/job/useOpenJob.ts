"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { replaceSearchShallow } from "@/lib/shallowSearch";

/** Open the job-detail overlay by setting `?job=<id>` on the current path.
 * Shallow in-place URL update so closing restores list state; reads no
 * search params, so callers do not need a Suspense boundary. */
export function useOpenJob(): (id: string) => void {
  const pathname = usePathname();
  return useCallback((id: string) => replaceSearchShallow(`${pathname}?job=${id}`), [pathname]);
}
