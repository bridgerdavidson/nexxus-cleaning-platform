"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
} from "@/components/ui/drawer";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CleanerAppointment, DeclineReason } from "@/hooks/useCleanerData";
import { formatTimeParts, offeredSlots } from "./job-presenters";

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "sick", label: "I'm not available" },
  { value: "too_far", label: "Too far from me" },
  { value: "not_my_service", label: "Not a service I do" },
  { value: "other", label: "Other reason" },
];

export function OfferActionsBar({
  appointment, onAccept, onDecline, onDone, layout = "inline",
}: {
  appointment: CleanerAppointment;
  onAccept: (slotIndex: number) => Promise<unknown> | void;
  onDecline: (reason: DeclineReason, other?: string) => Promise<unknown> | void;
  onDone?: () => void;
  layout?: "inline" | "stacked";
}) {
  const slots = offeredSlots(appointment);
  const multi = slots.length > 1;
  const [slotIndex, setSlotIndex] = useState(slots[0].slot_index);
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState<DeclineReason>("sick");
  const [other, setOther] = useState("");

  async function handleAccept() {
    setBusy("accept");
    try { await onAccept(slotIndex); onDone?.(); } catch { /* toast handled by hook */ } finally { setBusy(null); }
  }
  async function handleDecline() {
    setBusy("decline");
    try {
      await onDecline(reason, reason === "other" ? other.trim() || undefined : undefined);
      setDeclineOpen(false);
      onDone?.();
    } catch { /* toast handled by hook */ } finally { setBusy(null); }
  }

  return (
    <div className={cn(layout === "inline" ? "mt-3" : "")}>
      {multi && (
        <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Choose a time">
          {slots.map((s) => {
            const t = formatTimeParts(s.scheduled_time);
            const active = s.slot_index === slotIndex;
            return (
              <button
                key={s.slot_index}
                role="radio"
                aria-checked={active}
                onClick={() => setSlotIndex(s.slot_index)}
                className={cn(
                  "min-h-[44px] rounded-pill border px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-border bg-card text-muted-foreground",
                )}
              >
                {t.h} {t.ap}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={handleAccept} loading={busy === "accept"} disabled={busy !== null} className="flex-1">
          <Check /> Accept
        </Button>
        <Button variant="outline" onClick={() => setDeclineOpen(true)} disabled={busy !== null} className="flex-1">
          <X /> Decline
        </Button>
      </div>

      <Drawer open={declineOpen} onOpenChange={setDeclineOpen}>
        <DrawerContent className="max-h-[85dvh]">
          <DrawerHeader>
            <DrawerTitle>Decline this job?</DrawerTitle>
            <DrawerDescription>Let the office know why so they can reassign it.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4">
            <RadioGroup value={reason} onValueChange={(v) => setReason(v as DeclineReason)}>
              {DECLINE_REASONS.map((r) => (
                <label
                  key={r.value}
                  htmlFor={`decline-${r.value}`}
                  className="flex items-center gap-3 rounded-control border border-border bg-card px-3 py-3 text-sm font-medium"
                >
                  <RadioGroupItem value={r.value} id={`decline-${r.value}`} />
                  <span>{r.label}</span>
                </label>
              ))}
            </RadioGroup>
            {reason === "other" && (
              <div className="space-y-1.5">
                <Label htmlFor="decline-other">Tell us more</Label>
                <Textarea id="decline-other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Optional details" rows={3} />
              </div>
            )}
          </div>
          <DrawerFooter>
            <Button variant="destructive" onClick={handleDecline} loading={busy === "decline"}>Decline job</Button>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)} disabled={busy !== null}>Keep it</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
