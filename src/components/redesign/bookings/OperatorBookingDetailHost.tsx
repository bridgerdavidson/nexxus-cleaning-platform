"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { useDetailParam } from "@/hooks/useDetailParam";
import {
  useAdminAppointments,
  useAdminCleaners,
  cancelAppointment,
  deleteAppointment,
  updateAppointmentStatus,
  acceptCounterProposal,
} from "@/hooks/useAdminData";
import { normalizeTimeHHMM } from "@/lib/appointments/rescheduleOutcome";
import { STALE_BOOKING_MESSAGE, isStaleAcceptError } from "@/lib/appointments/staleBookingError";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { stripeNewChargeFlowUiEnabled } from "@/lib/stripe/flags";
import { BookingDetailSheet } from "./BookingDetailSheet";
import { toDetailVM } from "./booking-vm";
import { RescheduleDialog, type RescheduleInit } from "./reschedule/RescheduleDialog";
import { useRescheduleBooking } from "./reschedule/useRescheduleBooking";
import { CancelBookingDialog } from "./cancel/CancelBookingDialog";
import { CompleteRequestPayDialog } from "./CompleteRequestPayDialog";

/**
 * Shell-level `?booking=<id>` host: opens the booking detail sheet in place on
 * ANY operator page (overview queue, notifications, message chips), mirroring
 * the cleaner shell's `?job=` host. Mounted once in OperatorShell behind
 * can_view_bookings + Suspense (useDetailParam reads search params). The inner
 * component owns the heavy org-appointments query, so it only mounts after a
 * booking has been opened at least once.
 */
export function OperatorBookingDetailHost() {
  const { paramId, setParam } = useDetailParam("booking");
  // Retain the last id after the param clears so the sheet stays mounted
  // through its exit animation instead of vanishing mid-close.
  const [lastId, setLastId] = useState<string | null>(null);
  if (paramId && paramId !== lastId) setLastId(paramId);
  if (!lastId) return null;
  return (
    <HostInner
      key={lastId}
      appointmentId={lastId}
      open={!!paramId}
      onClose={() => setParam(null)}
    />
  );
}

type ConfirmKind = "cancel" | "delete";

function HostInner({
  appointmentId,
  open,
  onClose,
}: {
  appointmentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { currentOrgRole, currentOrganizationId, accessToken } = useAuth();
  const { appointments, refetch } = useAdminAppointments();
  const { cleaners } = useAdminCleaners();
  const { permissions } = useManagerPermissions();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canViewPayments = privileged || !!permissions?.can_view_payments;
  const canManagePayments = privileged || !!permissions?.can_manage_payments;
  const canEdit = privileged || !!permissions?.can_edit_bookings;
  const canHandleRequests = privileged || !!permissions?.can_handle_requests;
  const canDelete = privileged;
  // Cancel-with-fee can CAPTURE money, so it's gated like other payment
  // actions (mirrors the legacy AppointmentPanelHost): owners/admins always,
  // managers only with can_manage_payments. Others keep the soft-cancel.
  const feeCancel = stripeNewChargeFlowUiEnabled() && (privileged || !!permissions?.can_manage_payments);

  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [reschedInit, setReschedInit] = useState<RescheduleInit | null>(null);
  const [feeCancelOpen, setFeeCancelOpen] = useState(false);
  const [payOfferOpen, setPayOfferOpen] = useState(false);

  const raw = useMemo(() => appointments.find((x) => x.id === appointmentId) ?? null, [appointments, appointmentId]);
  const detail = useMemo(() => (raw ? toDetailVM(raw, canViewPayments) : null), [raw, canViewPayments]);

  // Completing a request-mode cleaner's job routes through the pay-offer
  // dialog (the cleaner names their pay; here the org opens with an offer).
  // Only operators who can manage payments may author an offer; anyone else
  // completes plainly and the cleaner opens the thread from their side.
  const assignedCleaner = useMemo(
    () => (raw?.cleaner_id ? cleaners.find((c) => c.id === raw.cleaner_id) ?? null : null),
    [cleaners, raw?.cleaner_id],
  );
  const completionNeedsPayOffer = assignedCleaner?.payout_model === "request" && canManagePayments;

  // The dialog's own open state derives from reschedInit (init !== null), so
  // reset it whenever the sheet's open prop goes false: otherwise browser
  // back / navigation clearing ?booking= would leave the dialog orphaned
  // over an unrelated page while HostInner stays mounted.
  useEffect(() => {
    if (!open) {
      setReschedInit(null);
      setFeeCancelOpen(false);
      setPayOfferOpen(false);
    }
  }, [open]);

  const { reschedule: rescheduleForAssign } = useRescheduleBooking(appointmentId);

  const cleanerOptions = useMemo(
    () =>
      cleaners.map((c) => ({
        id: c.id,
        name: `${c.user_profile?.first_name ?? ""} ${c.user_profile?.last_name ?? ""}`.trim() || "Cleaner",
      })),
    [cleaners],
  );

  const runStatus = useCallback(
    async (status: "in_progress" | "completed") => {
      setBusy(true);
      try {
        const r = await updateAppointmentStatus(appointmentId, status);
        await refetch();
        if (r.success) {
          toast.success(status === "completed" ? "Booking completed" : "Booking started",
            r.paymentError ? { description: `Payment: ${r.paymentError}` } : undefined);
        } else {
          toast.error(r.error || "Could not update the booking");
        }
      } finally {
        setBusy(false);
      }
    },
    [appointmentId, refetch],
  );

  // POST-first ordering (mirrors the cleaner completion step): the offer is
  // created before the status write so a completed request-mode job can never
  // exist without its pay thread. A 409 means the thread already exists (the
  // cleaner asked first); completion proceeds and it's handled from Payments.
  const sendPayOfferAndComplete = useCallback(
    async (amountCents: number, note: string | null): Promise<string | null> => {
      if (!currentOrganizationId) return "No organization";
      try {
        const res = await fetch(`/api/appointments/${appointmentId}/pay-request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            organization_id: currentOrganizationId,
            amount_cents: amountCents,
            ...(note ? { note } : {}),
          }),
        });
        if (!res.ok && res.status !== 409) {
          const data = await res.json().catch(() => ({}));
          return (data as { error?: string }).error || "Could not send the pay offer";
        }
      } catch {
        return "Could not send the pay offer";
      }
      setPayOfferOpen(false);
      await runStatus("completed");
      return null;
    },
    [appointmentId, currentOrganizationId, accessToken, runStatus],
  );

  const handleAssign = useCallback(
    async (cleanerId: string) => {
      if (!raw) return;
      setBusy(true);
      try {
        await rescheduleForAssign({
          scheduledDate: raw.scheduled_date,
          scheduledTime: normalizeTimeHHMM(raw.scheduled_time)!,
          cleanerId,
        });
        await refetch();
        toast.success("Cleaner assigned");
      } catch (e) {
        await refetch();
        const err = e as Error & { conflict?: boolean; stale?: boolean };
        if (err.conflict) {
          toast.error("That cleaner has a conflicting job at that time. Use Reschedule to override.");
        } else if (err.stale) {
          toast.error(STALE_BOOKING_MESSAGE);
        } else {
          toast.error(err.message || "Could not assign cleaner");
        }
      } finally {
        setBusy(false);
      }
    },
    [raw, rescheduleForAssign, refetch],
  );

  const handleAcceptCounter = useCallback(
    async (suggestedTimeId: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const r = await acceptCounterProposal({
          appointmentId,
          suggestedTimeId,
          organizationId: currentOrganizationId,
          accessToken,
        });
        await refetch();
        if (r.success) {
          toast.success("Proposed time accepted");
          onClose();
        } else {
          toast.error(isStaleAcceptError(r.error) ? STALE_BOOKING_MESSAGE : r.error || "Could not accept the time");
        }
      } finally {
        setBusy(false);
      }
    },
    [appointmentId, currentOrganizationId, accessToken, refetch, onClose],
  );

  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "cancel") {
        const r = await cancelAppointment(appointmentId);
        await refetch();
        if (r.success) { toast.success("Booking cancelled"); onClose(); }
        else { toast.error(r.error || "Could not cancel"); }
      } else {
        const r = await deleteAppointment(appointmentId);
        await refetch();
        if (r.success) { toast.success("Booking deleted"); onClose(); }
        else { toast.error(r.error || "Could not delete"); }
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, appointmentId, refetch, onClose]);

  const confirmCopy =
    confirm === "delete"
      ? { title: "Delete this booking?", description: "This permanently removes the booking. This cannot be undone.", confirmLabel: "Delete", destructive: true }
      : { title: "Cancel this booking?", description: "This can't be undone.", confirmLabel: "Cancel booking", destructive: false };

  return (
    <>
      <BookingDetailSheet
        open={open && !!detail}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        detail={detail}
        appointment={raw}
        cleanerOptions={cleanerOptions}
        canViewPayments={canViewPayments}
        canManagePayments={canManagePayments}
        canEdit={canEdit}
        canHandleRequests={canHandleRequests}
        canDelete={canDelete}
        busy={busy}
        onAssign={handleAssign}
        onAcceptCounter={handleAcceptCounter}
        onStart={() => runStatus("in_progress")}
        onComplete={() => (completionNeedsPayOffer ? setPayOfferOpen(true) : runStatus("completed"))}
        onOpenReschedule={(init) => setReschedInit(init ?? {})}
        onCancel={() => (feeCancel && raw ? setFeeCancelOpen(true) : setConfirm("cancel"))}
        onDelete={() => setConfirm("delete")}
        onMessageCustomer={() => {
          if (detail?.customerId)
            router.push(`/admin/messages?to=${detail.customerId}&appointment=${detail.id}`);
        }}
        onMessageCleaner={() => {
          if (detail?.cleanerId)
            router.push(`/admin/messages?to=${detail.cleanerId}&appointment=${detail.id}`);
        }}
      />
      {raw ? (
        <RescheduleDialog
          appointment={raw}
          appointments={appointments}
          cleaners={cleanerOptions}
          canHandleRequests={canHandleRequests}
          init={reschedInit}
          onOpenChange={(o) => {
            if (!o) setReschedInit(null);
          }}
          onDone={() => {
            setReschedInit(null);
            void refetch();
          }}
        />
      ) : null}
      {raw ? (
        <CancelBookingDialog
          open={feeCancelOpen}
          onOpenChange={setFeeCancelOpen}
          appointment={raw}
          onCancelled={async () => {
            setFeeCancelOpen(false);
            await refetch();
            onClose();
          }}
        />
      ) : null}
      {completionNeedsPayOffer && raw ? (
        <CompleteRequestPayDialog
          open={payOfferOpen}
          onOpenChange={setPayOfferOpen}
          cleanerName={
            `${assignedCleaner?.user_profile?.first_name ?? ""} ${assignedCleaner?.user_profile?.last_name ?? ""}`.trim() ||
            "This cleaner"
          }
          jobPriceCents={raw.total_price != null ? Math.round(Number(raw.total_price) * 100) : null}
          onSubmit={sendPayOfferAndComplete}
        />
      ) : null}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        destructive={confirmCopy.destructive}
        loading={busy}
        onConfirm={runConfirm}
      />
    </>
  );
}
