"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Open the operator booking-detail sheet by setting `?booking=<id>` on the
 * current path. Uses router.replace (no scroll) so closing restores list state;
 * reads no search params, so callers do not need a Suspense boundary (mirrors
 * the cleaner useOpenJob). Note: this replaces the whole query string; screens
 * that must preserve sibling params (e.g. Messages `?c=`) set the param in
 * place themselves instead of using this hook. */
export function useOpenBookingDetail(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (id: string) => router.replace(`${pathname}?booking=${id}`, { scroll: false }),
    [router, pathname],
  );
}
