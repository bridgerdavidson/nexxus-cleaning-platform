"use client";

import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DisputeStatusBadge, DisputeDeadlinePill } from "./payments-presenters";
import type { DisputeDetailVM } from "./payments-types";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

/** Plain-language guidance for the operator, keyed off the dispute's stage. No
 *  "submit evidence in Stripe" line: on Express, the tenant has no dashboard. */
function guidanceFor(vm: DisputeDetailVM): string {
  if (vm.isOpen) {
    return `${vm.payer} asked their bank to reverse this payment. Respond before the evidence deadline or the dispute is lost automatically: the amount is returned and a $15 dispute fee applies. Message the customer to resolve it (a mistaken dispute can be withdrawn with their bank).`;
  }
  switch (vm.badge) {
    case "won":
      return "This dispute was resolved in your favor. The payment stands and no action is needed.";
    case "lost":
      return "This dispute was lost. The amount was returned to the customer, a $15 dispute fee applied, and the cleaner's payout for this job was reversed.";
    default:
      return "This dispute is closed. No further action is needed.";
  }
}

export type DisputeDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dispute: DisputeDetailVM | null;
  onMessageCustomer: (homeownerId: string) => void;
};

export function DisputeDetailSheet({
  open,
  onOpenChange,
  dispute,
  onMessageCustomer,
}: DisputeDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {dispute ? (
          <>
            <SheetHeader className="pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <DisputeStatusBadge badge={dispute.badge} />
                {dispute.isOpen ? (
                  <DisputeDeadlinePill urgency={dispute.urgency} dueLabel={dispute.deadlineLabel} />
                ) : null}
              </div>
              <SheetTitle className="truncate">{dispute.payer}</SheetTitle>
              <SheetDescription>
                {dispute.service} · disputed {dispute.amountLabel}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-1 overflow-y-auto px-6 py-4">
              <Field label="Disputed" value={<span className="font-semibold tnum">{dispute.amountLabel}</span>} />
              <Field label="Reason" value={dispute.reason} />
              <Field label="Charged" value={dispute.method} />
              {dispute.paymentDateLabel ? <Field label="Job date" value={dispute.paymentDateLabel} /> : null}
              <Field label="Opened" value={dispute.openedLabel} />
              <Field label="Evidence due" value={dispute.deadlineLabel ?? "Not set"} />

              <Separator className="my-3" />
              <div className="rounded-control border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {guidanceFor(dispute)}
              </div>

              {dispute.isOpen && dispute.homeownerId ? (
                <>
                  <Separator className="my-3" />
                  <Button variant="secondary" onClick={() => onMessageCustomer(dispute.homeownerId!)}>
                    Message {dispute.payer}
                  </Button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
