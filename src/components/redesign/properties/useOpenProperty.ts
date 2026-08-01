"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { replaceSearchShallow } from "@/lib/shallowSearch";

/**
 * Open/close the operator property-detail sheet via `?property=<id>` (and,
 * for edit intent, a companion `?propertyEdit=1`) on the current path.
 * Mirrors useOpenBookingDetail: reads the current query string from
 * window.location inside each handler (never during render) so sibling
 * params (e.g. a Messages `?c=` thread selection) survive, and callers need no
 * Suspense boundary (unlike useSearchParams). Shallow in-place URL update (no
 * scroll) so closing restores list state.
 */
export function useOpenProperty(): {
  open: (id: string) => void;
  openForEdit: (id: string) => void;
  close: () => void;
} {
  const pathname = usePathname();

  const open = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.set("property", id);
      sp.delete("propertyEdit");
      replaceSearchShallow(`${pathname}?${sp.toString()}`);
    },
    [pathname],
  );

  const openForEdit = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.set("property", id);
      sp.set("propertyEdit", "1");
      replaceSearchShallow(`${pathname}?${sp.toString()}`);
    },
    [pathname],
  );

  const close = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.delete("property");
    sp.delete("propertyEdit");
    const qs = sp.toString();
    replaceSearchShallow(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname]);

  return { open, openForEdit, close };
}
