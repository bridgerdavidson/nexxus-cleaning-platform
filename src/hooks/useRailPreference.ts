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
    const read = () => {
      try {
        setExpandedState(window.localStorage.getItem(KEY) === "1");
      } catch {
        /* ignore */
      }
    };
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const setExpanded = useCallback((next: boolean) => {
    // Own state first so the setting still works this session when storage is
    // blocked; the event then fans the change out to every other instance.
    setExpandedState(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { expanded, setExpanded };
}
