'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Returns true only when `complete` transitions false -> true AFTER the data is
 * ready (i.e. once `ready` is true). This ignores the initial data-load
 * transition, where signals start empty so `complete` is momentarily false and
 * then flips true once queries resolve. Without the `ready` gate, an
 * already-set-up user (whose data loads to complete) would be misread as having
 * "just completed" and shown the success state. With it, the success state fires
 * only for a genuine in-session completion and clears on the next load.
 */
export function useJustCompleted(complete: boolean, ready: boolean): boolean {
  const wasIncomplete = useRef(false);
  const [justCompleted, setJustCompleted] = useState(false);
  useEffect(() => {
    if (!ready) return;
    if (!complete) {
      wasIncomplete.current = true;
      setJustCompleted(false);
    } else if (wasIncomplete.current) {
      setJustCompleted(true);
    }
  }, [complete, ready]);
  return justCompleted;
}
