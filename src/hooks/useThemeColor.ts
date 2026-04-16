"use client";

import { useEffect } from "react";
import { APP_BG_COLOR } from "../constants/theme";

export function useThemeColor(color: string, isActive: boolean) {
  useEffect(() => {
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    
    if (!metaThemeColor) {
      metaThemeColor = document.createElement("meta");
      metaThemeColor.setAttribute("name", "theme-color");
      document.head.appendChild(metaThemeColor);
    }

    if (isActive) {
      metaThemeColor.setAttribute("content", color);
    } else {
      metaThemeColor.setAttribute("content", APP_BG_COLOR);
    }

    return () => {
      if (isActive) {
        // Only revert on unmount if it was active
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
          meta.setAttribute("content", APP_BG_COLOR);
        }
      }
    };
  }, [color, isActive]);
}
