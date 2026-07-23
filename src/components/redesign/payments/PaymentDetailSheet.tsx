"use client";

import type { ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DisputedTag,
  PartialRefundTag,
  PayoutStatusBadge,
  SelfPayTag,
  TxnStatusBadge,
} from "./payments-presenters";
import type { PaymentLedger, PayoutDetailVM, TransactionDetailVM } from "./payments-types";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

function NotesBlock({ notes }: { notes: string }) {
  return (
    <>
      <Separator className="my-2" />
      <div className="space-y-1">
        <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">Notes</span>
        <p className="text-sm text-foreground">{notes}</p>
      </div>
    </>
  );
}

export type PaymentDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: PaymentLedger | null;
  txn: TransactionDetailVM | null;
  payout: PayoutDetailVM | null;
  canManagePayments: boolean;
  busy?: boolean;
  onRefund: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onMessage: (cleanerId: string | null) => void;
  /** Open the booking this row is tied to. Omitted when the viewer can't view bookings. */
  onViewBooking?: (appointmentId: string) => void;
};

export function PaymentDetailSheet({
  open,
  onOpenChange,
  kind,
  txn,
  payout,
  canManagePayments,
  busy,
  onRefund,
  onRetry,
  onDismiss,
  onMessage,
  onViewBooking,
}: PaymentDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {kind === "transactions" && txn ? (
          <>
            <SheetHeader className="pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <TxnStatusBadge badge={txn.badge} />
                {txn.disputed ? <DisputedTag /> : null}
                {txn.partiallyRefunded ? <PartialRefundTag /> : null}
                {txn.selfPay ? <SelfPayTag /> : null}
              </div>
              <SheetTitle className="truncate">{txn.payer}</SheetTitle>
              <SheetDescription>
                {txn.service} · {txn.dateLabel}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-1 overflow-y-auto px-6 py-4">
              <Field label="Amount" value={<span className="font-semibold tnum">{txn.amountLabel}</span>} />
              <Field label="Method" value={txn.method} />
              <Field label="Service" value={txn.service} />
              <Field label="Date" value={txn.dateLabel} />
              <Field label="Recorded" value={txn.createdLabel} />
              {txn.paidLabel ? <Field label="Paid" value={txn.paidLabel} /> : null}
              {txn.refundedLabel ? (
                <Field
                  label="Refunded"
                  value={<span className="font-semibold tnum">{txn.refundedLabel}</span>}
                />
              ) : null}
              {txn.reference ? <Field label="Reference" value={txn.reference} /> : null}
              {txn.notes ? <NotesBlock notes={txn.notes} /> : null}
              {(onViewBooking && txn.appointmentId) || txn.refundable ? (
                <>
                  <Separator className="my-3" />
                  <div className="flex flex-col gap-2">
                    {onViewBooking && txn.appointmentId ? (
                      <Button variant="secondary" onClick={() => onViewBooking(txn.appointmentId!)}>
                        <CalendarClock /> View booking
                      </Button>
                    ) : null}
                    {txn.refundable ? (
                      <Button
                        variant="outline"
                        className="text-destructive hover:bg-critical-50 hover:text-destructive"
                        loading={busy}
                        onClick={() => onRefund(txn.id)}
                      >
                        Refund
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </>
        ) : kind === "payouts" && payout ? (
          <>
            <SheetHeader className="pr-12">
              <div className="flex items-center gap-2">
                <PayoutStatusBadge badge={payout.badge} />
              </div>
              <SheetTitle className="truncate">{payout.cleaner}</SheetTitle>
              <SheetDescription>
                {payout.amountLabel} · {payout.dateLabel}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-1 overflow-y-auto px-6 py-4">
              <Field label="Amount" value={<span className="font-semibold tnum">{payout.amountLabel}</span>} />
              <Field label="Cleaner" value={payout.cleaner} />
              <Field label="Created" value={payout.createdLabel} />
              {payout.approvedLabel ? <Field label="Approved" value={payout.approvedLabel} /> : null}
              {payout.paidLabel ? <Field label="Paid" value={payout.paidLabel} /> : null}
              {payout.notes ? <NotesBlock notes={payout.notes} /> : null}

              {onViewBooking && payout.appointmentId ? (
                <>
                  <Separator className="my-3" />
                  <Button variant="secondary" onClick={() => onViewBooking(payout.appointmentId!)}>
                    <CalendarClock /> View booking
                  </Button>
                </>
              ) : null}

              {canManagePayments && payout.rawStatus === "failed" ? (
                <>
                  <Separator className="my-3" />
                  <div className="flex gap-2">
                    <Button loading={busy} onClick={() => onRetry(payout.id)}>
                      Retry now
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => onDismiss(payout.id)}>
                      Dismiss
                    </Button>
                  </div>
                </>
              ) : null}
              {payout.rawStatus === "pending" ? (
                <>
                  <Separator className="my-3" />
                  <Button variant="secondary" onClick={() => onMessage(payout.cleanerId)}>
                    Message {payout.cleaner}
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
