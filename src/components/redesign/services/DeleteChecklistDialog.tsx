"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteChecklistDialog({
  open, onOpenChange, busy, checklistName, itemCount, onConfirm,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean;
  checklistName: string; itemCount: number; onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${checklistName}?`}
      description={`This removes the checklist and its ${itemCount} task${itemCount === 1 ? "" : "s"}. This cannot be undone.`}
      confirmLabel="Delete"
      destructive
      loading={busy}
      onConfirm={onConfirm}
    />
  );
}
