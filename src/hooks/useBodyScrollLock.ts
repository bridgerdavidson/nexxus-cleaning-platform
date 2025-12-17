"use client";

import { useEffect } from "react";

/**
 * Custom hook to lock body scroll when a modal or overlay is open.
 * Prevents the background page from scrolling while the modal is displayed.
 * 
 * @param isLocked - Whether to lock the body scroll (typically tied to modal's isOpen state)
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return;

    // Store the current overflow and padding values
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;

    // Calculate scrollbar width to prevent layout shift
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    // Lock the body scroll
    document.body.style.overflow = "hidden";
    
    // Add padding to compensate for the scrollbar width to prevent layout shift
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    // Cleanup function to restore original styles
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isLocked]);
}

export default useBodyScrollLock;

