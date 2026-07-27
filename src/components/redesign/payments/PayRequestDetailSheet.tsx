"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { money2 } from "./payments-presenters";
import { marginLine, type MarginTone } from "./payRequestMath";
import type { PayRequestVM } from "./usePayRequests";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

const MARGIN_TONE_CLASS: Record<MarginTone, string> = {
  positive: "text-positive-700",
  caution: "text-caution-700",
  critical: "text-critical-700",
};

export type PayRequestDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: PayRequestVM | null;
  canManagePayments: boolean;
  busy: boolean;
  onApprove: (payRequestId: string) => Promise<boolean>;
  onCounter: (payRequestId: string, amountCents: number, note: string | null) => Promise<boolean>;
};

/**
 * Right sheet for one pay-request thread: the money trio up top, the full
 * offer history, and (when it's the org's turn) approve / counter actions.
 * Counter is the sheet's reason to exist; the band's Approve button covers
 * the happy path without opening it.
 */
export function PayRequestDetailSheet({
  open,
  onOpenChange,
  request,
  canManagePayments,
  busy,
  onApprove,
  onCounter,
}: PayRequestDetailSheetProps) {
  const [counterOpen, setCounterOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  // A fresh thread gets a fresh form; also covers reopening on another row.
  useEffect(() => {
    if (!open) return;
    setCounterOpen(false);
    setAmount("");
    setNote("");
    setAmountError(null);
  }, [open, request?.id]);

  if (!request) {
    return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" /></Sheet>;
  }

  const r = request;
  const margin = marginLine(r);
  const yourTurn = r.status === "pending_org";

  const submitCounter = async () => {
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setAmountError("Enter an amount of $0 or more.");
      return;
    }
    const cents = Math.round(dollars * 100);
    if (cents > r.jobPriceCents) {
      setAmountError(`Counter cannot exceed the job price (${money2(r.jobPriceCents / 100)}).`);
      return;
    }
    setAmountError(null);
    const ok = await onCounter(r.id, cents, note.trim() || null);
    if (ok) onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="pr-12">
          <div className="flex flex-wrap items-center gap-2">
            {yourTurn ? (
              <Badge variant="caution">Waiting on you</Badge>
            ) : (
              <Badge variant="secondary">Waiting on cleaner</Badge>
            )}
          </div>
          <SheetTitle className="truncate">{r.cleaner}</SheetTitle>
          <SheetDescription>
            {r.jobLabel}
            {r.dateLabel ? ` · ${r.dateLabel}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-1 overflow-y-auto px-6 py-4">
          <Field label="Job price" value={<span className="font-semibold tnum">{money2(r.jobPriceCents / 100)}</span>} />
          <Field
            label={r.latestActor === "cleaner" ? "Their ask" : "Your counter"}
            value={<span className="font-semibold tnum">{money2(r.latestAmountCents / 100)}</span>}
          />
          <Field
            label="Margin"
            value={<span className={`tnum ${MARGIN_TONE_CLASS[margin.tone]}`}>{margin.text}</span>}
          />

          <Separator className="my-3" />
          <p className="pb-1 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            Offer history
          </p>
          <div className="space-y-2">
            {r.offers.map((o) => (
              <div key={o.id} className="rounded-control border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium text-foreground">
                  {o.actor === "cleaner" ? `${r.cleaner} asked` : "You countered"}{" "}
                  <span className="font-semibold tnum">{money2(o.amountCents / 100)}</span>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{o.atLabel}</span>
                </p>
                {o.note ? <p className="mt-1 text-sm text-muted-foreground">{o.note}</p> : null}
              </div>
            ))}
          </div>

          {yourTurn && canManagePayments ? (
            <>
              <Separator className="my-3" />
              {counterOpen ? (
                <div className="space-y-3">
                  <FormField
                    label="Counter amount"
                    htmlFor="pr-counter-amount"
                    error={amountError ?? undefined}
                    helper={`Up to the job price (${money2(r.jobPriceCents / 100)}). The cleaner can accept or counter back.`}
                  >
                    <Input
                      id="pr-counter-amount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Note (optional)" htmlFor="pr-counter-note">
                    <Textarea
                      id="pr-counter-note"
                      rows={2}
                      maxLength={1000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Why this amount"
                    />
                  </FormField>
                  <div className="flex items-center gap-2">
                    <Button loading={busy} onClick={() => void submitCounter()}>
                      Send counter
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setCounterOpen(false)}>
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    loading={busy}
                    onClick={() => {
                      void onApprove(r.id).then((ok) => {
                        if (ok) onOpenChange(false);
                      });
                    }}
                  >
                    Approve {money2(r.latestAmountCents / 100)}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setCounterOpen(true)}>
                    Counter
                  </Button>
                </div>
              )}
            </>
          ) : null}

          {!yourTurn ? (
            <>
              <Separator className="my-3" />
              <div className="rounded-control border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {r.cleaner} is deciding on your counter. They can accept it or counter back; you&apos;ll
                see it here when they do.
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
