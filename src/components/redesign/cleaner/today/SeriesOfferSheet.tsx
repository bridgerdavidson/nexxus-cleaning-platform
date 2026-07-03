"use client";

import { useState } from "react";
import { Check, X, ChevronLeft } from "lucide-react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { DeclineReason } from "@/hooks/useCleanerData";
import type { SeriesOffer } from "./deriveSeriesOffers";
import { offeredSlots, formatTimeParts, formatDateLong } from "../shared/job-presenters";

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "sick", label: "I'm not available" },
  { value: "too_far", label: "Too far from me" },
  { value: "not_my_service", label: "Not a service I do" },
  { value: "other", label: "Other reason" },
];

export function SeriesOfferSheet({
  series, open, onOpenChange, onAcceptAll, onAcceptOne, onDeclineOne, accepting,
}: {
  series: SeriesOffer;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAcceptAll: (occurrences: { appointmentId: string; slotIndex: number }[]) => Promise<unknown> | void;
  onAcceptOne: (appointmentId: string, slotIndex: number) => Promise<unknown> | void;
  onDeclineOne: (appointmentId: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
  accepting: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<{ id: string; date: string } | null>(null);
  const [reason, setReason] = useState<DeclineReason>("sick");
  const [other, setOther] = useState("");
  // Ids acted on locally so a row leaves the list immediately (the query refetch confirms).
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const remaining = series.occurrences.filter((o) => !resolved.has(o.id));

  function markResolved(id: string) {
    setResolved((s) => new Set(s).add(id));
  }

  function cancelDecline() {
    setDeclining(null);
    setReason("sick");
    setOther("");
  }

  async function acceptOne(id: string, slotIndex: number) {
    setBusyId(id);
    try { await onAcceptOne(id, slotIndex); markResolved(id); }
    catch { /* toast handled by hook */ }
    finally { setBusyId(null); }
  }

  async function confirmDecline() {
    if (!declining) return;
    setBusyId(declining.id);
    try {
      await onDeclineOne(declining.id, reason, reason === "other" ? other.trim() || undefined : undefined);
      markResolved(declining.id);
      cancelDecline();
    } catch { /* toast handled by hook */ }
    finally { setBusyId(null); }
  }

  async function acceptAll() {
    // Only the dates the cleaner has not already actioned in this sheet.
    const args = remaining.map((o) => ({ appointmentId: o.id, slotIndex: offeredSlots(o)[0].slot_index }));
    if (args.length === 0) return;
    try { await onAcceptAll(args); onOpenChange(false); }
    catch { /* toast handled by hook */ }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90dvh]">
        {declining ? (
          <>
            <DrawerHeader>
              <button
                onClick={cancelDecline}
                className="mb-1 inline-flex min-h-[44px] items-center gap-1 rounded-control text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-4" /> Back
              </button>
              <DrawerTitle>Decline {formatDateLong(declining.date)}?</DrawerTitle>
              <DrawerDescription>Let the office know why so they can offer it to someone else.</DrawerDescription>
            </DrawerHeader>
            <div className="space-y-3 px-4">
              <RadioGroup value={reason} onValueChange={(v) => setReason(v as DeclineReason)}>
                {DECLINE_REASONS.map((r) => (
                  <label
                    key={r.value}
                    htmlFor={`series-decline-${r.value}`}
                    className="flex items-center gap-3 rounded-control border border-border bg-card px-3 py-3 text-sm font-medium"
                  >
                    <RadioGroupItem value={r.value} id={`series-decline-${r.value}`} />
                    <span>{r.label}</span>
                  </label>
                ))}
              </RadioGroup>
              {reason === "other" && (
                <div className="space-y-1.5">
                  <Label htmlFor="series-decline-other">Tell us more</Label>
                  <Textarea id="series-decline-other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Optional details" rows={3} />
                </div>
              )}
            </div>
            <DrawerFooter>
              <Button variant="destructive" onClick={confirmDecline} loading={busyId === declining.id}>Decline this date</Button>
              <Button variant="ghost" onClick={cancelDecline} disabled={busyId !== null}>Keep it</Button>
            </DrawerFooter>
          </>
        ) : (
          <>
            <DrawerHeader>
              <DrawerTitle>Pick your dates</DrawerTitle>
              <DrawerDescription>
                Accept the whole series, or take just the dates that work. The office offers any you decline to someone else.
              </DrawerDescription>
            </DrawerHeader>
            <div className="px-4">
              <Button onClick={acceptAll} loading={accepting} disabled={remaining.length === 0} className="w-full" size="lg">
                <Check /> Accept all {remaining.length}
              </Button>
            </div>
            <div className="mt-3 max-h-[52dvh] space-y-2.5 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
              {remaining.map((o) => {
                const t = formatTimeParts(o.scheduled_time);
                const slot = offeredSlots(o)[0].slot_index;
                return (
                  <div key={o.id} className="rounded-card border border-border bg-card p-3">
                    <div className="text-sm font-bold">{formatDateLong(o.scheduled_date)}</div>
                    <div className="text-xs text-muted-foreground">{t.h} {t.ap}</div>
                    <div className="mt-2.5 flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setDeclining({ id: o.id, date: o.scheduled_date })}
                        disabled={busyId !== null || accepting}
                        className="flex-1"
                        aria-label={`Decline ${o.scheduled_date}`}
                      >
                        <X /> Decline
                      </Button>
                      <Button
                        onClick={() => acceptOne(o.id, slot)}
                        loading={busyId === o.id}
                        disabled={(busyId !== null && busyId !== o.id) || accepting}
                        className="flex-1"
                        aria-label={`Accept ${o.scheduled_date}`}
                      >
                        <Check /> Accept
                      </Button>
                    </div>
                  </div>
                );
              })}
              {remaining.length === 0 && (
                <div className="py-6 text-center text-sm font-semibold text-positive-700">
                  You have responded to every date.
                </div>
              )}
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
