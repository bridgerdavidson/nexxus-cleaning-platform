"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Completion interstitial for a request-mode cleaner's job: the operator names
 * the pay offer that goes out with the completed booking. `onSubmit` sends the
 * offer and completes the booking (POST-first; a duplicate thread proceeds to
 * completion), returning an error message to show inline, or null on success.
 *
 * The offer is capped at the job price only when the customer is billed (the
 * cleaner is paid out of that charge). Company pays takes any amount: the org
 * funds it, so the cap would only block a job whose price was left at $0.
 */
export function CompleteRequestPayDialog({
  open,
  onOpenChange,
  cleanerName,
  jobPriceCents,
  isSelfPay,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cleanerName: string;
  jobPriceCents: number | null;
  isSelfPay: boolean;
  onSubmit: (amountCents: number, note: string | null) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setNote("");
    setError(null);
    setBusy(false);
  }, [open]);

  const priceLabel =
    jobPriceCents != null
      ? `$${(jobPriceCents / 100).toLocaleString("en-US", {
          minimumFractionDigits: jobPriceCents % 100 === 0 ? 0 : 2,
          maximumFractionDigits: 2,
        })}`
      : null;

  const submit = async () => {
    const dollars = parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("Enter an offer of $0 or more.");
      return;
    }
    const cents = Math.round(dollars * 100);
    if (!isSelfPay && jobPriceCents != null && cents > jobPriceCents) {
      setError(`Offer cannot exceed the job price (${priceLabel}).`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const err = await onSubmit(cents, note.trim() || null);
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Offer pay for this job</DialogTitle>
          <DialogDescription>
            {cleanerName} names their pay on each job. Your offer goes to them with the completed
            booking; money moves only after they accept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <FormField
            label="Offer amount"
            htmlFor="crp-amount"
            error={error ?? undefined}
            helper={
              isSelfPay
                ? "Any amount. Company pays: the card on file is charged the offer plus fees once they accept."
                : priceLabel
                  ? `Up to the job price (${priceLabel}). The cleaner is paid out of the customer's charge.`
                  : undefined
            }
          >
            <Input
              id="crp-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </FormField>
          <FormField label="Note (optional)" htmlFor="crp-note">
            <Textarea
              id="crp-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything they should know about this amount"
            />
          </FormField>
        </div>
        <DialogFooter className="mt-6 gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Send offer and complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
