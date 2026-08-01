"use client";
import { useCallback, useLayoutEffect, useState } from "react";

const KEY = "nexxus.railExpanded";

/** Per-user sidebar preference. Device-local; not a branding setting (decision 12). */
export function useRailPreference() {
  const [expanded, setExpanded] = useState(false);
  // Layout effect, not effect: the stored preference must apply BEFORE first
  // paint, or expanded-rail users watch a collapsed flash + animated shift on
  // every load. (Not a useState initializer: that would run during SSR/
  // hydration and mismatch the server-rendered collapsed markup.)
  useLayoutEffect(() => {
    try {
      setExpanded(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return { expanded, toggle };
}
