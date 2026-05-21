'use client';

import { useEffect } from 'react';

/**
 * Wires the Escape key to dismiss an open dialog/modal. Matches the
 * expectation that backdrop-click and Escape both close.
 *
 * Listener is attached only while `isOpen` is true to avoid global keydown
 * cost when no dialogs are mounted.
 */
export function useEscapeClose(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
}
