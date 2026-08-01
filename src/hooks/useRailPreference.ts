"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "nexxus.railExpanded";

/** Per-user sidebar preference. Device-local; not a branding setting (decision 12). */
export function useRailPreference() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
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
