"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { useDetailParam } from "@/hooks/useDetailParam";
import {
  useAdminAppointments,
  useAdminCleaners,
  assignCleanerToAppointment,
  cancelAppointment,
  deleteAppointment,
  updateAppointmentStatus,
  acceptCounterProposal,
} from "@/hooks/useAdminData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BookingDetailSheet } from "./BookingDetailSheet";
import { toDetailVM } from "./booking-vm";

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

  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useMemo(() => {
    const a = appointments.find((x) => x.id === appointmentId);
    return a ? toDetailVM(a, canViewPayments) : null;
  }, [appointments, appointmentId, canViewPayments]);

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

  const handleAssign = useCallback(
    async (cleanerId: string) => {
      setBusy(true);
      try {
        const r = await assignCleanerToAppointment(appointmentId, cleanerId);
        await refetch();
        if (r.success) toast.success("Cleaner assigned");
        else toast.error(r.error || "Could not assign cleaner");
      } finally {
        setBusy(false);
      }
    },
    [appointmentId, refetch],
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
          toast.error(r.error || "Could not accept the time");
        }
      } finally {
        setBusy(false);
      }
    },
    [appointmentId, currentOrganizationId, accessToken, refetch, onClose],
  );

  // Interim: reschedule still lives on the legacy dashboard (no redesign flow yet).
  // Carrying ?appointment= auto-opens the legacy side panel on the right booking.
  const handleReschedule = useCallback(() => {
    router.push(`/admin-dashboard?tab=bookings&appointment=${appointmentId}`);
  }, [router, appointmentId]);

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
      : { title: "Cancel this booking?", description: "The customer and cleaner will be notified.", confirmLabel: "Cancel booking", destructive: false };

  return (
    <>
      <BookingDetailSheet
        open={open && !!detail}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        detail={detail}
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
        onComplete={() => runStatus("completed")}
        onReschedule={handleReschedule}
        onCancel={() => setConfirm("cancel")}
        onDelete={() => setConfirm("delete")}
        onMessageCustomer={() => {
          if (detail?.customerId)
            router.push(`/app/admin-dashboard/messages?to=${detail.customerId}&appointment=${detail.id}`);
        }}
        onMessageCleaner={() => {
          if (detail?.cleanerId)
            router.push(`/app/admin-dashboard/messages?to=${detail.cleanerId}&appointment=${detail.id}`);
        }}
      />
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
