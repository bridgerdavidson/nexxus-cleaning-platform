"use client";

import React, { useEffect, useRef, useState } from "react";
import { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

interface ScrollAwareFabProps {
  /** Visible label when expanded. */
  label: string;
  /** Leading icon (always visible, even when collapsed). */
  icon: LucideIcon;
  onClick: () => void;
  /** Falls back to `label` for screen readers when omitted. */
  ariaLabel?: string;
  /** Pixel width when expanded; tune per label length. Default 200. */
  expandedWidth?: number;
}

/**
 * Generic mobile floating action button that collapses to an icon-only circle on
 * scroll-down and re-expands on scroll-up. Presentational only — the caller owns
 * the action (open a modal, navigate, etc.). Shared by the homeowner "Request
 * Cleaning" FAB and the admin/manager "New booking" FAB so the scroll/motion
 * behavior lives in exactly one place.
 */
export default function ScrollAwareFab({
  label,
  icon: Icon,
  onClick,
  ariaLabel,
  expandedWidth = 200,
}: ScrollAwareFabProps) {
  const [collapsed, setCollapsed] = useState(false);
  const lastYRef = useRef(0);
  // Respect prefers-reduced-motion: the admin/manager pages don't wrap this in a
  // <MotionConfig reducedMotion="user">, so honor it here. When reduced, skip the
  // scroll-collapse entirely and render a static, fully-expanded button.
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (shouldReduceMotion) return;
    let ticking = false;
    // Accumulated upward distance since the last downward move. Expanding only
    // after a deliberate amount adds a small buffer so a brief wobble doesn't
    // pop the button open.
    let upAccum = 0;
    // Require ~a finger's worth of sustained scroll-up before re-expanding.
    const EXPAND_THRESHOLD = 36;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        // Clamp out iOS rubber-band overscroll: at the bottom, scrollY rises past
        // the max during the bounce and then falls back as it settles, and that
        // fall would otherwise read as an intentional scroll-up and re-expand the
        // button. Treating the overscroll zone as the page edge makes that delta 0.
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        const y = Math.min(Math.max(window.scrollY, 0), maxScroll);
        const delta = y - lastYRef.current;
        if (y <= 0) {
          upAccum = 0;
          setCollapsed(false);
        } else if (delta > 0) {
          // Any real downward movement cancels a pending expand; collapse past 80px.
          upAccum = 0;
          if (delta > 6 && y > 80) setCollapsed(true);
        } else if (delta < 0) {
          upAccum += -delta;
          if (upAccum > EXPAND_THRESHOLD) setCollapsed(false);
        }
        lastYRef.current = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [shouldReduceMotion]);

  const isCollapsed = collapsed && !shouldReduceMotion;
  const spring = { type: "spring" as const, stiffness: 320, damping: 30 };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={false}
      animate={{ width: isCollapsed ? 56 : expandedWidth }}
      transition={shouldReduceMotion ? { duration: 0 } : spring}
      style={{ height: 56, touchAction: "manipulation" }}
      aria-label={ariaLabel ?? label}
      className="flex items-center justify-start gap-2 px-[18px] bg-primary-600 text-white font-semibold rounded-full shadow-lg hover:bg-primary-700 hover:shadow-xl active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 overflow-hidden"
    >
      <Icon className="w-5 h-5 shrink-0" />
      <motion.span
        initial={false}
        animate={{ opacity: isCollapsed ? 0 : 1 }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: isCollapsed ? 0.12 : 0.2 }}
        className="whitespace-nowrap"
      >
        {label}
      </motion.span>
    </motion.button>
  );
}
