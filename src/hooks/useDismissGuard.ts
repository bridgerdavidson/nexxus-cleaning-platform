"use client";

import { useCallback, useState } from "react";
import { useEscapeClose } from "./useEscapeClose";

interface UseDismissGuardArgs {
  /** Whether the host modal is open. */
  isOpen: boolean;
  /** Whether the host modal has unsaved user input. */
  isDirty: boolean;
  /** Suppress the guard entirely while a submit is in flight (the submit owns the close). */
  isSubmitting?: boolean;
  /** Called to actually close the modal once a dismissal is confirmed (or when pristine). */
  onConfirmClose: () => void;
}

export interface DismissGuard {
  /** Wire this to backdrop click, the X button, and the Cancel button. */
  requestClose: () => void;
  /** Whether the "discard changes?" confirmation dialog is showing. */
  confirmOpen: boolean;
  /** User confirmed they want to discard: closes the dialog and the modal. */
  confirmDiscard: () => void;
  /** User changed their mind: closes only the dialog, keeps editing. */
  cancelDiscard: () => void;
}

/**
 * Guards a data-entry modal against accidental dismissal. When the modal is dirty, any
 * close request (backdrop / X / Cancel / Escape) first surfaces a confirmation dialog; a
 * pristine modal closes silently. Owns Escape for the parent modal, so adopting modals must
 * delete their own `useEscapeClose(isOpen, onClose)` and route closes through `requestClose`.
 *
 * Pair with <DiscardChangesDialog isOpen={confirmOpen} onConfirm={confirmDiscard} onCancel={cancelDiscard} />.
 */
export function useDismissGuard({
  isOpen,
  isDirty,
  isSubmitting = false,
  onConfirmClose,
}: UseDismissGuardArgs): DismissGuard {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (isSubmitting) return; // never interrupt an in-flight submit
    if (isDirty) {
      setConfirmOpen(true);
      return;
    }
    onConfirmClose(); // pristine: close silently
  }, [isDirty, isSubmitting, onConfirmClose]);

  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false);
    onConfirmClose();
  }, [onConfirmClose]);

  const cancelDiscard = useCallback(() => setConfirmOpen(false), []);

  // Escape on the parent routes through the guard, but only while the discard dialog is not
  // up (the dialog registers its own Escape handler -> cancelDiscard when it's open).
  useEscapeClose(isOpen && !confirmOpen, requestClose);

  return { requestClose, confirmOpen, confirmDiscard, cancelDiscard };
}
