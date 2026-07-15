"use client";

import { useRef, useState } from "react";
import {
  CalendarClock,
  Clock,
  Mail,
  MessageSquare,
  Play,
  CheckCircle2,
  CalendarCog,
  CalendarX2,
  Pencil,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookingStatusBadge, PaymentBadge } from "./bookings-presenters";
import { Field, DiscardChangesDialog } from "./detail-atoms";
import { JobMessagesPanel } from "./JobMessagesPanel";
import { OperatorPaymentSection } from "./payment/OperatorPaymentSection";
import type { BookingDetailVM, CleanerOption } from "./bookings-types";
import type { RescheduleInit } from "./reschedule/RescheduleDialog";
import { EditBookingDetailsForm } from "./edit/EditBookingDetailsForm";
import type { AdminAppointment } from "@/hooks/useAdminData";
import { stripeNewChargeFlowUiEnabled } from "@/lib/stripe/flags";

export type BookingDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: BookingDetailVM | null;
  /** Raw row backing `detail`, needed by the Edit-details form. Null in the
   *  brief window before the host's appointments query resolves, and in the
   *  dev preview (which has no raw AdminAppointment fixture) - Edit details
   *  simply doesn't render in either case. */
  appointment: AdminAppointment | null;
  cleanerOptions: CleanerOption[];
  canViewPayments: boolean;
  canManagePayments: boolean;
  canEdit: boolean;
  canHandleRequests: boolean;
  canDelete: boolean;
  busy?: boolean;
  onAssign: (cleanerId: string) => void;
  onAcceptCounter: (suggestedTimeId: string) => void;
  onStart: () => void;
  onComplete: () => void;
  onOpenReschedule: (init?: RescheduleInit) => void;
  onCancel: () => void;
  onDelete: () => void;
  onMessageCustomer: () => void;
  onMessageCleaner: () => void;
};

export function BookingDetailSheet({
  open,
  onOpenChange,
  detail,
  appointment,
  cleanerOptions,
  canViewPayments,
  canManagePayments,
  canEdit,
  canHandleRequests,
  canDelete,
  busy,
  onAssign,
  onAcceptCounter,
  onStart,
  onComplete,
  onOpenReschedule,
  onCancel,
  onDelete,
  onMessageCustomer,
  onMessageCleaner,
}: BookingDetailSheetProps) {
  // Whether the edit form (when mounted) has unsaved changes. A ref, not
  // state: only close-time behavior reads it, and holding it here (outside
  // SheetContent) does not carry any page state across close/reopen, so the
  // unmount-on-close freshness guarantee is untouched. The form keeps it
  // current and resets it to false on unmount; view mode never writes it.
  const dirtyRef = useRef(false);
  const [confirmClose, setConfirmClose] = useState(false);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          // Escape / overlay click / the X button all land here. `open` is
          // controlled, so swallowing the close keeps the sheet up while the
          // discard confirm (same copy as the in-form Cancel) takes over.
          if (!o && dirtyRef.current) {
            setConfirmClose(true);
            return;
          }
          onOpenChange(o);
        }}
      >
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          {detail ? (
            <DetailBody
              detail={detail}
              appointment={appointment}
              dirtyRef={dirtyRef}
              cleanerOptions={cleanerOptions}
              canViewPayments={canViewPayments}
              canManagePayments={canManagePayments}
              canEdit={canEdit}
              canHandleRequests={canHandleRequests}
              canDelete={canDelete}
              busy={busy}
              onAssign={onAssign}
              onAcceptCounter={onAcceptCounter}
              onStart={onStart}
              onComplete={onComplete}
              onOpenReschedule={onOpenReschedule}
              onCancel={onCancel}
              onDelete={onDelete}
              onMessageCustomer={onMessageCustomer}
              onMessageCleaner={onMessageCleaner}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <DiscardChangesDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        description="This booking's details have unsaved changes."
        onConfirm={() => {
          setConfirmClose(false);
          dirtyRef.current = false;
          onOpenChange(false);
        }}
      />
    </>
  );
}

type DetailBodyProps = Omit<BookingDetailSheetProps, "open" | "onOpenChange" | "detail"> & {
  detail: BookingDetailVM;
  dirtyRef: React.MutableRefObject<boolean>;
};

/**
 * Rendered as a child of SheetContent so Radix unmounts it on close: a
 * reopened sheet always starts back in view mode instead of resuming
 * mid-edit (this is the load-bearing reason the `page` state lives here and
 * not on BookingDetailSheet itself).
 */
function DetailBody({
  detail,
  appointment,
  dirtyRef,
  cleanerOptions,
  canViewPayments,
  canManagePayments,
  canEdit,
  canHandleRequests,
  canDelete,
  busy,
  onAssign,
  onAcceptCounter,
  onStart,
  onComplete,
  onOpenReschedule,
  onCancel,
  onDelete,
  onMessageCustomer,
  onMessageCleaner,
}: DetailBodyProps) {
  const [page, setPage] = useState<"view" | "edit">("view");

  // Only a confirmed (cleaner-accepted) booking can be started. A pending one is
  // still awaiting the cleaner's acceptance / counter-proposal, so starting it
  // would bypass that workflow. Starting/completing/rescheduling/cancelling all
  // edit the booking, so each also requires can_edit_bookings (mirrors the
  // server-side lifecycle/cancel/notify-reschedule routes).
  const canStart = detail.status === "confirmed" && !!detail.cleanerId && canEdit;
  const canComplete = detail.status === "in_progress" && canManagePayments && canEdit;
  const cancellable = detail.status !== "cancelled" && detail.status !== "completed" && canEdit;
  // Pending/confirmed only (tighter than Cancel's gate): in-progress, completed,
  // and cancelled bookings are read-only for Reschedule and Edit details.
  const editable = (detail.status === "pending" || detail.status === "confirmed") && canEdit;

  if (page === "edit" && appointment) {
    return (
      <EditBookingDetailsForm
        appointment={appointment}
        dirtyRef={dirtyRef}
        onDone={() => setPage("view")}
      />
    );
  }

  return (
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
          {/* Assigning goes through the reschedule route: can_edit_bookings
              plus the cleaner-change escalation to can_handle_requests, so
              the select needs BOTH flags or the server would 403. */}
          <Select
            value={detail.cleanerId ?? ""}
            onValueChange={(v) => onAssign(v)}
            disabled={busy || !canHandleRequests || !canEdit}
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
            <Collapsible title="Messages">
              <JobMessagesPanel appointmentId={detail.id} cleanerId={detail.cleanerId} />
            </Collapsible>
          </>
        ) : null}

        {canViewPayments ? (
          <>
            <Separator />
            {stripeNewChargeFlowUiEnabled() && appointment ? (
              <OperatorPaymentSection
                appointment={appointment}
                canManagePayments={canManagePayments}
                priceLabel={detail.priceLabel}
              />
            ) : (
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
            )}
          </>
        ) : null}

        {detail.counterProposals.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                <Sparkles className="size-3.5" /> Cleaner proposed times
              </div>
              {detail.counterProposals.map((cp) =>
                editable ? (
                  // A div with button semantics, NOT a <button>: the row
                  // contains the interactive Accept <Button>, and nesting
                  // interactive elements is invalid HTML (same class of
                  // bug as PR #134's nested-interactive rows).
                  <div
                    key={cp.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenReschedule({ date: cp.date, time: cp.time })}
                    onKeyDown={(e) => {
                      // Only act on keys pressed on the row itself: keydown
                      // from the inner Accept button bubbles here, and
                      // preventDefault would cancel its native click.
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenReschedule({ date: cp.date, time: cp.time });
                      }
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-control border border-border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="text-sm text-foreground">{cp.label}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAcceptCounter(cp.id);
                      }}
                      loading={busy}
                      disabled={!canHandleRequests}
                    >
                      Accept
                    </Button>
                  </div>
                ) : (
                  <div
                    key={cp.id}
                    className="flex items-center justify-between gap-3 rounded-control border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="text-sm text-foreground">{cp.label}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onAcceptCounter(cp.id)}
                      loading={busy}
                      disabled={!canHandleRequests}
                    >
                      Accept
                    </Button>
                  </div>
                ),
              )}
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
                  className="flex items-center justify-between gap-3 rounded-control border border-border bg-muted/30 px-3 py-2"
                >
                  <span className="text-sm text-foreground">{w.label}</span>
                  {editable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onOpenReschedule({ date: w.date, time: w.startTime, windowId: w.id })}
                    >
                      Pick a time
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}

        {detail.declinedReason || detail.specialRequests || detail.notes ? (
          <>
            <Separator />
            <Collapsible title="Requests & notes">
              <div className="space-y-5">
                {detail.declinedReason ? (
                  <Field label="Decline reason">{detail.declinedReason}</Field>
                ) : null}
                {detail.specialRequests ? (
                  <Field label="Special requests">{detail.specialRequests}</Field>
                ) : null}
                {detail.notes ? <Field label="Notes">{detail.notes}</Field> : null}
              </div>
            </Collapsible>
          </>
        ) : null}

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
          {editable ? (
            <Button variant="outline" onClick={() => onOpenReschedule()}>
              <CalendarCog /> Reschedule
            </Button>
          ) : null}
          {editable && appointment ? (
            <Button variant="outline" onClick={() => setPage("edit")}>
              <Pencil /> Edit details
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
  );
}
