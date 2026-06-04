"use client";

import { useEffect, useRef } from "react";
import type { DraftStore } from "@/lib/formDraft";

interface UseFormDraftArgs<T> {
  store: DraftStore<T>;
  orgId: string | null | undefined;
  /** The host modal is open. */
  isOpen: boolean;
  /** Only persist when true (e.g. exclude pre-filled / non-restorable launches). */
  eligible: boolean;
  /** The current draft body, recomputed by the caller each render. Memoize it upstream. */
  body: T;
  /** Debounce for the throttled write while typing (ms). */
  debounceMs?: number;
}

/**
 * Persists a form's in-progress state to its draft store while the modal is open, so a full
 * reload can restore it. Debounces writes while the user types, clears the draft the moment
 * the form returns to pristine, and flushes synchronously on `beforeunload` so the very last
 * keystroke survives a hard reload.
 *
 * This handles the WRITE side only. The host modal still: (1) calls `store.load(orgId)` on open
 * to hydrate, and (2) calls `store.clear()` on a successful submit and on a deliberate close.
 */
export function useFormDraft<T>({
  store,
  orgId,
  isOpen,
  eligible,
  body,
  debounceMs = 400,
}: UseFormDraftArgs<T>): void {
  // Latest body in a ref so the beforeunload flush always writes the freshest snapshot.
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const active = isOpen && eligible && !!orgId;

  // Has the form been dirty at any point during this open session? This gates clear-on-pristine:
  // on a reload the modal reopens pristine and `orgId` resolves a tick before the host hydrates
  // the saved draft, so a naive "clear when pristine" would wipe the draft before hydration can
  // read it. We only clear a pristine form once the user has actually entered (then emptied) it.
  const everDirtyRef = useRef(false);
  useEffect(() => {
    if (!isOpen) everDirtyRef.current = false;
  }, [isOpen]);

  // Debounced write while dirty; clear only when a previously-dirty form is emptied.
  useEffect(() => {
    if (!active || !orgId) return;
    if (!store.isDirty(body)) {
      if (everDirtyRef.current) store.clear();
      return;
    }
    everDirtyRef.current = true;
    const t = setTimeout(() => store.save(orgId, body), debounceMs);
    return () => clearTimeout(t);
  }, [active, orgId, body, store, debounceMs]);

  // Synchronous flush on hard reload / tab close (debounced write may not have fired yet).
  useEffect(() => {
    if (!active || !orgId) return;
    const flush = () => {
      if (store.isDirty(bodyRef.current)) store.save(orgId, bodyRef.current);
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [active, orgId, store]);
}
