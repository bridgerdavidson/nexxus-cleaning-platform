"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Open/close the operator property-detail sheet via `?property=<id>` on the
 * current path. Mirrors useOpenBookingDetail: reads the current query string
 * from window.location inside each handler (never during render) so sibling
 * params (e.g. a Messages `?c=` thread selection) survive, and callers need no
 * Suspense boundary (unlike useSearchParams). Uses router.replace (no scroll)
 * so closing restores list state.
 */
export function useOpenProperty(): { open: (id: string) => void; close: () => void } {
  const router = useRouter();
  const pathname = usePathname();

  const open = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.set("property", id);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const close = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    sp.delete("property");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname]);

  return { open, close };
}
