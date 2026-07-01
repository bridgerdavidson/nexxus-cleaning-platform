"use client";

import {
  CalendarClock,
  Clock,
  Mail,
  MessageSquare,
  Play,
  CheckCircle2,
  CalendarCog,
  CalendarX2,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookingStatusBadge, PaymentBadge } from "./bookings-presenters";
import { JobMessagesPanel } from "./JobMessagesPanel";
import type { BookingDetailVM, CleanerOption } from "./bookings-types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export type BookingDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: BookingDetailVM | null;
  cleanerOptions: CleanerOption[];
  canViewPayments: boolean;
  canManagePayments: boolean;
  canDelete: boolean;
  busy?: boolean;
  onAssign: (cleanerId: string) => void;
  onAcceptCounter: (suggestedTimeId: string) => void;
  onStart: () => void;
  onComplete: () => void;
  onReschedule: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onMessageCustomer: () => void;
  onMessageCleaner: () => void;
};

export function BookingDetailSheet({
  open,
  onOpenChange,
  detail,
  cleanerOptions,
  canViewPayments,
  canManagePayments,
  canDelete,
  busy,
  onAssign,
  onAcceptCounter,
  onStart,
  onComplete,
  onReschedule,
  onCancel,
  onDelete,
  onMessageCustomer,
  onMessageCleaner,
}: BookingDetailSheetProps) {
  // Only a confirmed (cleaner-accepted) booking can be started. A pending one is
  // still awaiting the cleaner's acceptance / counter-proposal, so starting it
  // would bypass that workflow.
  const canStart = detail ? detail.status === "confirmed" && !!detail.cleanerId : false;
  const canComplete = detail ? detail.status === "in_progress" && canManagePayments : false;
  const cancellable = detail ? detail.status !== "cancelled" && detail.status !== "completed" : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {detail ? (
          <>
            <SheetHeader className="pr-12">
              <div className="flex items-center gap-2">
                <BookingStatusBadge badge={detail.badge} />
                {detail.isSelfPay ? <PaymentBadge payment={{ tone: "selfpay", label: "Self-pay" }} /> : null}
              </div>
              <SheetTitle className="mt-1">{detail.title}</SheetTitle>
              <SheetDescription>{detail.service}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Date">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="size-4 text-muted-foreground" />
                    {detail.dateLabel}
                  </span>
                </Field>
                <Field label="Time">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-4 text-muted-foreground" />
                    {detail.timeLabel}
                    {detail.durationLabel ? ` · ${detail.durationLabel}` : ""}
                  </span>
                </Field>
              </div>

              <Separator />

              <Field label="Customer">
                <div className="font-medium text-foreground">{detail.customer}</div>
                {detail.customerEmail ? (
                  <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Mail className="size-3.5" />
                    {detail.customerEmail}
                  </div>
                ) : null}
              </Field>

              <Field label={detail.isUnassigned ? "Assign cleaner" : "Cleaner"}>
                <Select
                  value={detail.cleanerId ?? ""}
                  onValueChange={(v) => onAssign(v)}
                  disabled={busy}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose a cleaner" />
                  </SelectTrigger>
                  <SelectContent>
                    {cleanerOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {detail.customerId || detail.cleanerId ? (
                <div className="flex flex-wrap gap-2">
                  {detail.customerId ? (
                    <Button variant="outline" size="sm" onClick={onMessageCustomer}>
                      <MessageSquare /> Message customer
                    </Button>
                  ) : null}
                  {detail.cleanerId ? (
                    <Button variant="outline" size="sm" onClick={onMessageCleaner}>
                      <MessageSquare /> Message cleaner
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {detail.customerId && detail.cleanerId ? (
                <>
                  <Separator />
                  <JobMessagesPanel appointmentId={detail.id} cleanerId={detail.cleanerId} />
                </>
              ) : null}

              {canViewPayments ? (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <Field label="Payment">
                      <PaymentBadge payment={detail.payment} /> {detail.payment ? null : "Not recorded"}
                    </Field>
                    {detail.priceLabel ? (
                      <div className="text-right">
                        <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                          Total
                        </div>
                        <div className="text-lg font-bold text-foreground">{detail.priceLabel}</div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {detail.counterProposals.length > 0 ? (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      <Sparkles className="size-3.5" /> Cleaner proposed times
                    </div>
                    {detail.counterProposals.map((cp) => (
                      <div
                        key={cp.id}
                        className="flex items-center justify-between gap-3 rounded-control border border-border bg-muted/30 px-3 py-2"
                      >
                        <span className="text-sm text-foreground">{cp.label}</span>
                        <Button size="sm" variant="secondary" onClick={() => onAcceptCounter(cp.id)} loading={busy}>
                          Accept
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {detail.counterWindows.length > 0 ? (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      <Sparkles className="size-3.5" /> Cleaner proposed windows
                    </div>
                    {detail.counterWindows.map((w) => (
                      <div
                        key={w.id}
                        className="rounded-control border border-border bg-muted/30 px-3 py-2 text-sm text-foreground"
                      >
                        {w.label}
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Use Reschedule to pick a time inside one of these windows.
                    </p>
                  </div>
                </>
              ) : null}

              {detail.declinedReason ? (
                <Field label="Decline reason">{detail.declinedReason}</Field>
              ) : null}
              {detail.specialRequests ? (
                <Field label="Special requests">{detail.specialRequests}</Field>
              ) : null}
              {detail.notes ? <Field label="Notes">{detail.notes}</Field> : null}

              <Separator />

              <div className="grid grid-cols-2 gap-2">
                {canStart ? (
                  <Button variant="secondary" onClick={onStart} loading={busy}>
                    <Play /> Mark started
                  </Button>
                ) : null}
                {canComplete ? (
                  <Button onClick={onComplete} loading={busy}>
                    <CheckCircle2 /> Mark complete
                  </Button>
                ) : null}
                {cancellable ? (
                  <Button variant="outline" onClick={onReschedule}>
                    <CalendarCog /> Reschedule
                  </Button>
                ) : null}
                {cancellable ? (
                  <Button variant="outline" onClick={onCancel} loading={busy}>
                    <CalendarX2 /> Cancel booking
                  </Button>
                ) : null}
              </div>

              {canDelete ? (
                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:bg-critical-50 hover:text-destructive"
                  onClick={onDelete}
                  loading={busy}
                >
                  <Trash2 /> Delete booking
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
