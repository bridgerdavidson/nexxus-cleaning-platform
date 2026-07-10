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
  assignCleanerToAppointment,
  cancelAppointment,
  deleteAppointment,
  updateAppointmentStatus,
  acceptCounterProposal,
} from "@/hooks/useAdminData";
import { cancelAppointments, deleteAppointments } from "@/lib/bulkAppointments";
import { describeBulkAppointmentResult } from "@/lib/bulkAppointmentMessages";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OperatorBookingsView } from "./OperatorBookingsView";
import { BookingDetailSheet } from "./BookingDetailSheet";
import { useOpenOperatorBooking } from "./new-booking/useOpenOperatorBooking";
import { deriveBookings, localISODate, segmentCounts } from "./deriveBookings";
import { toDetailVM, toRowVM } from "./booking-vm";
import type {
  BookingRowAction,
  BookingRowVM,
  BookingSegment,
  StatusFilter,
} from "./bookings-types";

type ConfirmKind = "cancel" | "delete" | "bulkCancel" | "bulkDelete";
type ConfirmState = { kind: ConfirmKind; ids: string[] } | null;

/**
 * Hook-backed Operator Bookings. Consumes the existing headless admin hooks and
 * mutation helpers unchanged (so realtime + cache invalidation come for free),
 * derives the filtered/sorted list, and drives the presentational View, detail
 * Sheet, and confirm dialog. Reschedule and "new booking" fall back to the
 * legacy flow until those screens are redesigned.
 */
export function OperatorBookings() {
  const router = useRouter();
  const openBooking = useOpenOperatorBooking();
  const { currentOrgRole, currentOrganizationId, accessToken } = useAuth();
  const { appointments, loading, error, refetch } = useAdminAppointments();
  const { cleaners } = useAdminCleaners();
  const { permissions } = useManagerPermissions();
  const { paramId: bookingParam, setParam: setBookingParam } = useDetailParam("booking");

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canViewPayments = privileged || !!permissions?.can_view_payments;
  const canManagePayments = privileged || !!permissions?.can_manage_payments;
  const canEdit = privileged || !!permissions?.can_edit_bookings;
  const canHandleRequests = privileged || !!permissions?.can_handle_requests;
  const canDelete = privileged;

  const [segment, setSegment] = useState<BookingSegment>("upcoming");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [cleanerFilter, setCleanerFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);

  const today = useMemo(() => localISODate(new Date()), []);

  // --- detail open/close (URL-synced for deep links) ---
  const openDetail = useCallback(
    (id: string) => {
      setDetailId(id);
      setBookingParam(id);
    },
    [setBookingParam],
  );
  const closeDetail = useCallback(() => {
    setDetailId(null);
    setBookingParam(null);
  }, [setBookingParam]);

  // Keep the detail in sync with the `?booking=<id>` deep link: open it when the
  // param is present and close it when the param is removed (e.g. browser Back).
  useEffect(() => {
    setDetailId(bookingParam);
  }, [bookingParam]);

  const avatarById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of cleaners) m.set(c.id, c.user_profile?.avatar_url ?? null);
    return m;
  }, [cleaners]);

  const cleanerOptions = useMemo(
    () =>
      cleaners.map((c) => ({
        id: c.id,
        name: `${c.user_profile?.first_name ?? ""} ${c.user_profile?.last_name ?? ""}`.trim() || "Cleaner",
      })),
    [cleaners],
  );

  const counts = useMemo(() => segmentCounts(appointments, today), [appointments, today]);

  const derived = useMemo(
    () => deriveBookings(appointments, { segment, search, statusFilter, cleanerFilter, today }),
    [appointments, segment, search, statusFilter, cleanerFilter, today],
  );

  const rows: BookingRowVM[] = useMemo(
    () => derived.map((a) => toRowVM(a, today, canViewPayments, avatarById)),
    [derived, today, canViewPayments, avatarById],
  );

  // Keep the selection scoped to what is currently visible. When a filter or
  // segment hides a selected row, drop it so the bulk bar count stays honest
  // and bulk cancel/delete can never act on a booking the operator can't see.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [rows]);

  const detail = useMemo(() => {
    if (!detailId) return null;
    const a = appointments.find((x) => x.id === detailId);
    return a ? toDetailVM(a, canViewPayments) : null;
  }, [detailId, appointments, canViewPayments]);

  // --- selection ---
  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected = rows.length > 0 && rows.every((r) => next.has(r.id));
      if (everySelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }, [rows]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // --- single-row + detail actions ---
  const runStatus = useCallback(
    async (id: string, status: "in_progress" | "completed") => {
      setBusy(true);
      try {
        const r = await updateAppointmentStatus(id, status);
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
    [refetch],
  );

  const handleAssign = useCallback(
    async (id: string, cleanerId: string) => {
      setBusy(true);
      try {
        const r = await assignCleanerToAppointment(id, cleanerId);
        await refetch();
        if (r.success) {
          toast.success("Cleaner assigned");
        } else {
          toast.error(r.error || "Could not assign cleaner");
        }
      } finally {
        setBusy(false);
      }
    },
    [refetch],
  );

  const handleAcceptCounter = useCallback(
    async (id: string, suggestedTimeId: string) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        const r = await acceptCounterProposal({
          appointmentId: id,
          suggestedTimeId,
          organizationId: currentOrganizationId,
          accessToken,
        });
        await refetch();
        if (r.success) {
          toast.success("Proposed time accepted");
          closeDetail();
        } else {
          toast.error(r.error || "Could not accept the time");
        }
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, accessToken, refetch, closeDetail],
  );

  // Interim: reschedule still lives on the legacy dashboard (no redesign flow yet).
  // Carrying ?appointment= auto-opens the legacy side panel on the right booking.
  const handleReschedule = useCallback(
    (id: string) => {
      router.push(`/admin-dashboard?tab=bookings&appointment=${id}`);
    },
    [router],
  );

  // --- confirm dialog (single + bulk cancel/delete) ---
  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    const { kind, ids } = confirm;
    setBusy(true);
    try {
      if (kind === "cancel") {
        const r = await cancelAppointment(ids[0]);
        await refetch();
        if (r.success) { toast.success("Booking cancelled"); closeDetail(); }
        else { toast.error(r.error || "Could not cancel"); }
      } else if (kind === "delete") {
        const r = await deleteAppointment(ids[0]);
        await refetch();
        if (r.success) { toast.success("Booking deleted"); closeDetail(); }
        else { toast.error(r.error || "Could not delete"); }
      } else if (kind === "bulkCancel") {
        const result = await cancelAppointments(ids);
        await refetch();
        const { message, variant } = describeBulkAppointmentResult("cancel", result);
        toast[variant](message);
        clearSelection();
      } else if (kind === "bulkDelete") {
        const result = await deleteAppointments(ids);
        await refetch();
        const { message, variant } = describeBulkAppointmentResult("delete", result);
        toast[variant](message);
        clearSelection();
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, refetch, clearSelection, closeDetail]);

  const handleRowAction = useCallback((id: string, action: BookingRowAction) => {
    if (action === "open" || action === "assign") openDetail(id);
    else if (action === "cancel") setConfirm({ kind: "cancel", ids: [id] });
    else if (action === "delete") setConfirm({ kind: "delete", ids: [id] });
  }, [openDetail]);

  const confirmCopy = useMemo(() => {
    if (!confirm) return null;
    const n = confirm.ids.length;
    switch (confirm.kind) {
      case "cancel":
        return { title: "Cancel this booking?", description: "The customer and cleaner will be notified.", confirmLabel: "Cancel booking", destructive: false };
      case "delete":
        return { title: "Delete this booking?", description: "This permanently removes the booking. This cannot be undone.", confirmLabel: "Delete", destructive: true };
      case "bulkCancel":
        return { title: `Cancel ${n} booking${n === 1 ? "" : "s"}?`, description: "The selected bookings will be cancelled.", confirmLabel: "Cancel bookings", destructive: false };
      case "bulkDelete":
        return { title: `Delete ${n} booking${n === 1 ? "" : "s"}?`, description: "This permanently removes the selected bookings. This cannot be undone.", confirmLabel: "Delete", destructive: true };
    }
  }, [confirm]);

  return (
    <>
      <OperatorBookingsView
        loading={loading}
        error={Boolean(error)}
        onRetry={() => refetch()}
        rows={rows}
        counts={counts}
        totalCount={appointments.length}
        canViewPayments={canViewPayments}
        canEdit={canEdit}
        canHandleRequests={canHandleRequests}
        canDelete={canDelete}
        bulkBusy={busy}
        segment={segment}
        onSegmentChange={setSegment}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        cleanerFilter={cleanerFilter}
        onCleanerFilterChange={setCleanerFilter}
        cleanerOptions={cleanerOptions}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        onClearSelection={clearSelection}
        onOpenRow={openDetail}
        onRowAction={handleRowAction}
        onBulkCancel={() => setConfirm({ kind: "bulkCancel", ids: [...selectedIds] })}
        onBulkDelete={() => setConfirm({ kind: "bulkDelete", ids: [...selectedIds] })}
        onNewBooking={canEdit ? openBooking : undefined}
      />

      <BookingDetailSheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) closeDetail();
        }}
        detail={detail}
        cleanerOptions={cleanerOptions}
        canViewPayments={canViewPayments}
        canManagePayments={canManagePayments}
        canEdit={canEdit}
        canHandleRequests={canHandleRequests}
        canDelete={canDelete}
        busy={busy}
        onAssign={(cleanerId) => detail && handleAssign(detail.id, cleanerId)}
        onAcceptCounter={(stid) => detail && handleAcceptCounter(detail.id, stid)}
        onStart={() => detail && runStatus(detail.id, "in_progress")}
        onComplete={() => detail && runStatus(detail.id, "completed")}
        onReschedule={() => detail && handleReschedule(detail.id)}
        onCancel={() => detail && setConfirm({ kind: "cancel", ids: [detail.id] })}
        onDelete={() => detail && setConfirm({ kind: "delete", ids: [detail.id] })}
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
        title={confirmCopy?.title ?? ""}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        destructive={confirmCopy?.destructive}
        loading={busy}
        onConfirm={runConfirm}
      />
    </>
  );
}
