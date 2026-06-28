"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { cn } from "@/lib/utils";

/**
 * Full-screen slide-in surface that covers the whole shell (top bar, bottom nav)
 * so a thread/detail gets the entire screen, like a native app. Render-prop hands
 * children a `close()` that animates out then fires `onClosed`. Extracted from the
 * operator MobileThreadOverlay; the cleaner Messages thread and operator Messages
 * both consume it. (CleanerJobDetailOverlay still has its own copy; migrate later.)
 *
 * - `desktopHidden`: reproduce the operator `lg:hidden` (operator has a desktop
 *   two-pane). Phone-first surfaces pass false (the default).
 * - `keyboardAware`: lift the bottom above the iOS keyboard (for surfaces with a
 *   text input). Pass false for read-only takeovers.
 */
export function MobileTakeover({
  onClosed,
  children,
  ariaLabel,
  desktopHidden = false,
  keyboardAware = true,
}: {
  onClosed: () => void;
  children: (close: () => void) => ReactNode;
  ariaLabel?: string;
  desktopHidden?: boolean;
  keyboardAware?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const closingRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setShown(false);
    window.setTimeout(onClosed, 300);
  }, [onClosed]);
  // Keep the latest close reachable from mount-only effects without re-running them.
  const closeRef = useRef(close);
  closeRef.current = close;

  // Slide in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Mount-only: lock background scroll + focus the surface, bind Escape. MUST be
  // mount-only: re-running .focus() on every render steals focus from the composer
  // on each keystroke and collapses the iOS keyboard. Escape closes only when
  // nothing nested (a Radix/vaul drawer) already consumed it (preventDefault).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Keep the composer above the on-screen keyboard on iOS (publishes `--kbd`).
  useKeyboardInset(ref, keyboardAware);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), var(--kbd, 0px))" }}
      className={cn(
        "redesign-overlay fixed inset-0 z-50 flex flex-col bg-card outline-none",
        "pt-[env(safe-area-inset-top)]",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        desktopHidden && "lg:hidden",
        shown ? "translate-x-0" : "translate-x-full",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">{children(close)}</div>
    </div>
  );
}
