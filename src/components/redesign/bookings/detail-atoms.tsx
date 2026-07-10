'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// Shared atoms for the booking-detail surfaces (detail sheet, reschedule
// dialog, edit-details form) so their labels and dirty-discard confirms stay
// identical. Note: several other surfaces (homeowner detail, payments sheet,
// cleaner job overlay, platform org detail) carry their own local Field copy;
// consolidating those is a separate app-wide sweep.

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function DiscardChangesDialog({
  open,
  onOpenChange,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What has unsaved changes, e.g. "This booking's schedule has unsaved changes." */
  description: string;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Discard changes?"
      description={description}
      confirmLabel="Discard"
      onConfirm={onConfirm}
    />
  );
}
