"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MODAL_QUERY_KEY = "modal";

/**
 * Keeps a modal's open state in the URL (`?modal=<key>`) so a full page reload reopens it.
 * Mirrors useAppointmentPanel. Pair with the dashboard's `?tab=` persistence (the tab restores
 * first, then this reopens the modal on that tab) and a draft store (see useFormDraft) to
 * restore the modal's contents. Only one modal marker lives in the URL at a time; close only
 * touches the marker when it matches this key, so modals never clobber each other.
 */
export function useReopenableModalUrl(key: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isOpenFromUrl = searchParams.get(MODAL_QUERY_KEY) === key;

  const openModalUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(MODAL_QUERY_KEY) === key) return;
    params.set(MODAL_QUERY_KEY, key);
    // push (not replace) so browser-back closes the modal.
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [key, pathname, router, searchParams]);

  const closeModalUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(MODAL_QUERY_KEY) !== key) return;
    params.delete(MODAL_QUERY_KEY);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [key, pathname, router, searchParams]);

  return { isOpenFromUrl, openModalUrl, closeModalUrl };
}
