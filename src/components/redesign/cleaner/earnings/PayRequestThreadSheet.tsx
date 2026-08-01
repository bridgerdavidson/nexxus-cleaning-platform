// src/components/redesign/cleaner/earnings/PayRequestThreadSheet.tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { money2 } from "@/components/redesign/payments/payments-presenters";
import type { CleanerPayThread } from "@/hooks/useCleanerPayRequests";

/**
 * The cleaner's side of one pay-request negotiation: the offer history, then
 * Accept (takes the org's number as-is) or a counter of their own.
 *
 * PRIVACY: the job price never appears here. The thread comes from
 * /api/pay-requests/mine, which does not send it, so a counter has no visible
 * ceiling on this screen. An over-price counter is not an error either: the
 * server escalates it rather than rejecting, precisely so the cap can never be
 * inferred from a failure message.
 */
export function PayRequestThreadSheet({
  open,
  onOpenChange,
  thread,
  busy,
  onAccept,
  onCounter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: CleanerPayThread | null;
  busy: boolean;
  onAccept: (payRequestId: string) => Promise<boolean>;
  onCounter: (payRequestId: string, amountCents: number, note: string | null) => Promise<boolean>;
}) {
  const [countering, setCountering] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Keep the last thread so the sheet holds its content through the close
  // animation instead of blanking mid-slide.
  const [last, setLast] = useState<CleanerPayThread | null>(null);
  if (thread && thread !== last) setLast(thread);

  useEffect(() => {
    if (!open) return;
    setCountering(false);
    setAmount("");
    setNote("");
    setError(null);
  }, [open, thread?.id]);

  const t = thread ?? last;
  if (!t) return <Drawer open={open} onOpenChange={onOpenChange}><DrawerContent /></Drawer>;

  const submitCounter = async () => {
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("Enter an amount of $0 or more.");
      return;
    }
    setError(null);
    const ok = await onCounter(t.id, Math.round(dollars * 100), note.trim() || null);
    if (ok) onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Your pay for this job</DrawerTitle>
          <DrawerDescription>
            {t.jobLabel}
            {t.propertyLabel ? ` · ${t.propertyLabel}` : ""}
          </DrawerDescription>
        </DrawerHeader>

        <div className="max-h-[45vh] space-y-2 overflow-y-auto px-5">
          {t.offers.map((o) => (
            <div key={o.id} className="rounded-control border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium text-foreground">
                {o.actor === "cleaner" ? "You asked" : "They offered"}{" "}
                <span className="font-semibold tabular-nums">{money2(o.amountCents / 100)}</span>
              </p>
              {o.note ? <p className="mt-1 text-sm text-muted-foreground">{o.note}</p> : null}
            </div>
          ))}
        </div>

        {countering ? (
          <div className="space-y-3 px-5 pt-4">
            <FormField
              label="Your amount"
              htmlFor="cl-thread-amount"
              error={error ?? undefined}
              helper="They can accept this or come back with another number."
            >
              <Input
                id="cl-thread-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                className="min-h-[44px] text-base"
              />
            </FormField>
            <FormField label="Note (optional)" htmlFor="cl-thread-note">
              <Input
                id="cl-thread-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                placeholder="Why this amount"
                className="min-h-[44px] text-base"
              />
            </FormField>
          </div>
        ) : null}

        <DrawerFooter>
          {countering ? (
            <>
              <Button
                size="lg"
                loading={busy}
                onClick={() => void submitCounter()}
                className="w-full min-h-[44px]"
              >
                Send
              </Button>
              <Button
                variant="ghost"
                size="lg"
                disabled={busy}
                onClick={() => setCountering(false)}
                className="w-full min-h-[44px]"
              >
                Back
              </Button>
            </>
          ) : (
            <>
              <Button
                size="lg"
                loading={busy}
                onClick={() => {
                  void onAccept(t.id).then((ok) => {
                    if (ok) onOpenChange(false);
                  });
                }}
                className="w-full min-h-[44px]"
              >
                Accept {money2(t.currentOfferCents / 100)}
              </Button>
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => setCountering(true)}
                className="w-full min-h-[44px]"
              >
                Ask for a different amount
              </Button>
            </>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
