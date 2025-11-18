// src/hooks/useTabVisibility.ts
"use client";

import { useEffect } from "react";

export function useTabVisibility() {
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Optional: dev-only logging
      // console.log("[useTabVisibility]", document.visibilityState);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
}
