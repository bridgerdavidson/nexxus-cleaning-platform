"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteServiceDialog({
  open, onOpenChange, busy, serviceName, canDelete, appointmentCount, seriesCount, onConfirm,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean;
  serviceName: string; canDelete: boolean; appointmentCount: number; seriesCount: number;
  onConfirm: () => void;
}) {
  if (!canDelete) {
    const parts = [
      appointmentCount > 0 ? `${appointmentCount} booking${appointmentCount === 1 ? "" : "s"}` : null,
      seriesCount > 0 ? `${seriesCount} recurring series` : null,
    ].filter(Boolean).join(" and ");
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="This service is in use"
        description={`${serviceName} is used by ${parts}. Disable it instead of deleting so past records stay intact.`}
        confirmLabel="Got it"
        onConfirm={() => onOpenChange(false)}
      />
    );
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${serviceName}?`}
      description="This permanently removes the service and all of its checklists. This cannot be undone."
      confirmLabel="Delete"
      destructive
      loading={busy}
      onConfirm={onConfirm}
    />
  );
}
