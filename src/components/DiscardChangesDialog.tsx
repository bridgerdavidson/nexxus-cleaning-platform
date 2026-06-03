"use client";

import ConfirmModal from "./ConfirmModal";

interface DiscardChangesDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Pass a higher z (e.g. "z-[400]") when stacking over an already-elevated modal. */
  zIndexClassName?: string;
}

/**
 * Standard "you have unsaved changes" confirmation shown when a user tries to dismiss a
 * dirty data-entry modal. Thin wrapper over ConfirmModal with fixed copy. Drive it with
 * the values returned by useDismissGuard.
 */
export default function DiscardChangesDialog({
  isOpen,
  onConfirm,
  onCancel,
  zIndexClassName,
}: DiscardChangesDialogProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onCancel}
      onConfirm={onConfirm}
      title="Discard your changes?"
      message="Your progress will be lost. Are you sure you want to leave?"
      confirmText="Leave"
      cancelText="Keep editing"
      tone="warning"
      zIndexClassName={zIndexClassName}
    />
  );
}
