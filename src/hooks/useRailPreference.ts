"use client";
import { useCallback, useLayoutEffect, useState } from "react";

const KEY = "nexxus.railExpanded";
// Same-tab sync channel: the preference is set from Settings -> Appearance
// while a SEPARATE hook instance in OperatorShell drives the live rail, and
// the browser's "storage" event only fires in OTHER tabs.
const EVENT = "nexxus:railExpanded";

/** Per-user sidebar preference. Device-local; not a branding setting (decision 12). */
export function useRailPreference() {
  const [expanded, setExpandedState] = useState(false);
  // Layout effect, not effect: the stored preference must apply BEFORE first
  // paint, or expanded-rail users watch a collapsed flash + animated shift on
  // every load. (Not a useState initializer: that would run during SSR/
  // hydration and mismatch the server-rendered collapsed markup.)
  useLayoutEffect(() => {
    const readStorage = () => {
      try {
        setExpandedState(window.localStorage.getItem(KEY) === "1");
      } catch {
        /* ignore */
      }
    };
    // The same-tab event CARRIES the value: re-reading storage here would make
    // the sync depend on storage being writable (blocked storage would leave
    // the rail frozen while the switch flips) and, worse, a failed setItem
    // followed by a successful getItem would synchronously revert the
    // dispatching instance's own just-set state.
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") setExpandedState(detail);
      else readStorage();
    };
    readStorage();
    window.addEventListener(EVENT, onSync);
    window.addEventListener("storage", readStorage);
    return () => {
      window.removeEventListener(EVENT, onSync);
      window.removeEventListener("storage", readStorage);
    };
  }, []);
  const setExpanded = useCallback((next: boolean) => {
    // Own state first so the setting still works this session when storage is
    // blocked; the event then fans the value out to every other instance.
    setExpandedState(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: next }));
  }, []);
  return { expanded, setExpanded };
}
