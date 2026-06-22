"use client";

import { X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

export type CustomersBulkBarProps = {
  count: number;
  canDelete: boolean;
  busy?: boolean;
  onDelete: () => void;
  onClear: () => void;
};

/** Sticky action bar shown while one or more customers are selected. Floats
 *  above the mobile bottom nav and clears the desktop rail. Delete is the only
 *  bulk action for customers. */
export function CustomersBulkBar({ count, canDelete, busy, onDelete, onClear }: CustomersBulkBarProps) {
  if (count <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 lg:bottom-6 lg:pl-[56px]">
      <div className="pointer-events-auto flex items-center gap-2 rounded-pill border border-border bg-card px-3 py-2 shadow-soft-lg">
        <span className="px-2 text-sm font-semibold text-foreground">{count} selected</span>
        {canDelete ? (
          <Button variant="destructive" size="sm" onClick={onDelete} loading={busy}>
            <Trash2 /> Delete
          </Button>
        ) : null}
        <IconButton aria-label="Clear selection" className="h-9 w-9" onClick={onClear}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}
