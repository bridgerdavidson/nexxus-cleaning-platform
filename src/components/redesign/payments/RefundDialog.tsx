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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money2 } from "./payments-presenters";
import { REFUND_REASONS, type RefundReason } from "./payments-types";

export type RefundDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payer: string;
  grossLabel: string;
  /** Already refunded / in-flight, or null when nothing has been refunded yet. */
  refundedLabel: string | null;
  /** Dollars still refundable (the cap + the default). */
  remaining: number;
  busy?: boolean;
  onConfirm: (amountDollars: number, reason: RefundReason) => void;
};

/**
 * Confirm + amount entry for a refund, so a single tap can no longer irreversibly
 * refund the full charge and claw back the cleaner. Prefills the remaining amount,
 * allows a smaller (partial) refund, and caps at what's left. Built from the Dialog
 * primitives (ConfirmDialog has no body slot for the amount field).
 */
export function RefundDialog({
  open,
  onOpenChange,
  payer,
  grossLabel,
  refundedLabel,
  remaining,
  busy,
  onConfirm,
}: RefundDialogProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<RefundReason>("requested_by_customer");

  // Reset to a fresh prefill each time the dialog opens.
  useEffect(() => {
    if (open) {
      setAmount(remaining > 0 ? remaining.toFixed(2) : "");
      setReason("requested_by_customer");
    }
  }, [open, remaining]);

  const amt = parseFloat(amount);
  // Small epsilon so a prefilled max (e.g. 120.00) isn't rejected by float noise.
  const valid = Number.isFinite(amt) && amt > 0 && amt <= remaining + 0.005;
  const isFull = valid && Math.abs(amt - remaining) < 0.005;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Refund {payer}</DialogTitle>
          <DialogDescription>
            Charged {grossLabel}
            {refundedLabel ? ` · ${refundedLabel} already refunded` : ""}. This refunds the
            customer and reverses the cleaner&apos;s payout for the job. It can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Refund amount</Label>
            <Input
              id="refund-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max={remaining}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="refund-amount-help"
            />
            <p id="refund-amount-help" className="text-xs text-muted-foreground">
              Up to {money2(remaining)} refundable{isFull ? " (full remaining amount)" : ""}.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as RefundReason)}>
              <SelectTrigger aria-label="Refund reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFUND_REASONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="mt-6 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            disabled={!valid}
            onClick={() => onConfirm(amt, reason)}
          >
            {valid ? `Refund ${money2(amt)}` : "Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
