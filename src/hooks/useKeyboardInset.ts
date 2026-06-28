"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps a fixed/overlay surface's bottom lifted above the iOS on-screen keyboard.
 * The visual viewport shrinks when the keyboard opens but a fixed/dvh layout does
 * not, so we publish the keyboard height as `--kbd` on the target element; the
 * caller pads its bottom by `max(env(safe-area-inset-bottom), var(--kbd, 0px))`.
 *
 * Mount-only (empty deps): the effect is idempotent and re-binding per render is
 * unnecessary. `enabled=false` is a no-op (e.g. takeovers with no text input).
 */
export function useKeyboardInset(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      ref.current?.style.setProperty("--kbd", `${kb}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
