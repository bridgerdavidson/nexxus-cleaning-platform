"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { replaceSearchShallow } from "@/lib/shallowSearch";

/** Open the operator booking-detail sheet by setting `?booking=<id>` on the
 * current path. Shallow in-place URL update so closing restores list state.
 * Reads the current query string from window.location inside the click handler
 * (never during render), so sibling params like the Messages `?c=` thread
 * selection survive AND callers need no Suspense boundary (unlike
 * useSearchParams). */
export function useOpenBookingDetail(): (id: string) => void {
  const pathname = usePathname();
  return useCallback(
    (id: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.set("booking", id);
      replaceSearchShallow(`${pathname}?${sp.toString()}`);
    },
    [pathname],
  );
}
