"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChecklistFormDialog({
  open, onOpenChange, busy, initial, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  initial?: { name: string; price_adder: number } | null;
  onSubmit: (v: { name: string; price_adder: number }) => void;
}) {
  const [name, setName] = useState("");
  const [adder, setAdder] = useState(0);
  useEffect(() => {
    if (open) { setName(initial?.name ?? ""); setAdder(initial?.price_adder ?? 0); }
  }, [open, initial]);

  const valid = name.trim().length > 0 && adder >= 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit checklist" : "New checklist"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cl-name">Name</Label>
            <Input id="cl-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-adder">Price add-on</Label>
            <Input id="cl-adder" type="number" min={0} step={0.01} value={adder}
              onChange={(e) => setAdder(Number(e.target.value))} />
            <p className="text-xs text-muted-foreground">Added to the base price when this checklist is chosen at booking.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => valid && onSubmit({ name: name.trim(), price_adder: adder })} disabled={!valid || busy} loading={busy}>
            {initial ? "Save changes" : "Create checklist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
