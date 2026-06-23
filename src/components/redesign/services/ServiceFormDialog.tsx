"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type ServiceFormValues = {
  name: string; description: string; base_price: number;
  duration_minutes: number; service_type: string; is_active: boolean;
};

const SUGGESTIONS = ["regular", "deep", "move_out", "move_in", "custom", "one_time", "recurring", "seasonal", "office", "commercial"];

const BLANK: ServiceFormValues = {
  name: "", description: "", base_price: 0, duration_minutes: 60, service_type: "regular", is_active: true,
};

export function ServiceFormDialog({
  open, onOpenChange, busy, initial, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  initial?: ServiceFormValues | null;
  onSubmit: (v: ServiceFormValues) => void;
}) {
  const [v, setV] = useState<ServiceFormValues>(BLANK);
  useEffect(() => {
    if (open) setV(initial ?? BLANK);
  }, [open, initial]);

  const valid = v.name.trim().length > 0 && v.base_price >= 0 && v.duration_minutes >= 1;
  const submit = () => {
    if (!valid) return;
    onSubmit({
      ...v,
      name: v.name.trim(),
      description: v.description.trim(),
      service_type: v.service_type.trim().toLowerCase().replace(/\s+/g, "_") || "regular",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit service" : "New service"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">Name</Label>
            <Input id="svc-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-desc">Description</Label>
            <Textarea id="svc-desc" rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="svc-price">Base price</Label>
              <Input id="svc-price" type="number" min={0} step={0.01} value={v.base_price}
                onChange={(e) => setV({ ...v, base_price: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-dur">Duration (minutes)</Label>
              <Input id="svc-dur" type="number" min={1} step={1} value={v.duration_minutes}
                onChange={(e) => setV({ ...v, duration_minutes: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="svc-type">Type</Label>
            <Input id="svc-type" list="svc-type-suggestions" value={v.service_type}
              onChange={(e) => setV({ ...v, service_type: e.target.value })} />
            <datalist id="svc-type-suggestions">
              {SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch checked={v.is_active} onCheckedChange={(c: boolean) => setV({ ...v, is_active: c })} aria-label="Active" /> Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || busy} loading={busy}>
            {initial ? "Save changes" : "Create service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
