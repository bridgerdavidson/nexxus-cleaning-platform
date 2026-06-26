"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Shown when leaving a dirty section: Save changes / Discard / Keep editing. */
export function SettingsLeaveDialog({
  open, saving, onSave, onDiscard, onCancel,
}: { open: boolean; saving: boolean; onSave: () => void | Promise<void>; onDiscard: () => void; onCancel: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription>
            You have unsaved changes in this section. Save them before leaving, or discard them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Keep editing</Button>
          <Button variant="outline" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button onClick={onSave} loading={saving}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
