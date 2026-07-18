"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { useDetailParam } from "@/hooks/useDetailParam";
import {
  useAdminAppointments,
  useAdminCleaners,
  cancelAppointment,
  deleteAppointment,
} from "@/hooks/useAdminData";
import { cancelAppointments, deleteAppointments } from "@/lib/bulkAppointments";
import { describeBulkAppointmentResult } from "@/lib/bulkAppointmentMessages";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OperatorBookingsView } from "./OperatorBookingsView";
import { useOpenOperatorBooking } from "./new-booking/useOpenOperatorBooking";
import { deriveBookings, localISODate, segmentCounts } from "./deriveBookings";
import { toRowVM } from "./booking-vm";
import {
  BOOKING_SEGMENTS,
  type BookingRowAction,
  type BookingRowVM,
  type BookingSegment,
  type StatusFilter,
} from "./bookings-types";

type ConfirmKind = "cancel" | "delete" | "bulkCancel" | "bulkDelete";
type ConfirmState = { kind: ConfirmKind; ids: string[] } | null;

// Filters live in the URL (deep links + a Back button that restores them). The
// defaults are omitted from the query string to keep clean URLs, mirroring how
// Payments handles `?ledger=`.
const DEFAULT_SEGMENT: BookingSegment = "upcoming";
const VALID_SEGMENTS = new Set<string>(BOOKING_SEGMENTS.map((s) => s.id));
const VALID_STATUSES = new Set<StatusFilter>([
  "all",
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
]);

/**
 * Hook-backed Operator Bookings. Consumes the existing headless admin hooks and
 * mutation helpers unchanged (so realtime + cache invalidation come for free),
 * derives the filtered/sorted list, and drives the presentational View plus the
 * row/bulk confirm dialog. The booking detail sheet itself lives in the
 * shell-level OperatorBookingDetailHost, which owns the `?booking=<id>` param;
 * opening a row just sets that param. Reschedule and "new booking" fall back to
 * the legacy flow until those screens are redesigned.
 */
export function OperatorBookings() {
  const openBooking = useOpenOperatorBooking();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentOrgRole } = useAuth();
  const { appointments, loading, error, refetch } = useAdminAppointments();
  const { cleaners } = useAdminCleaners();
  const { permissions } = useManagerPermissions();
  const { setParam: setBookingParam } = useDetailParam("booking");

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canViewPayments = privileged || !!permissions?.can_view_payments;
  const canEdit = privileged || !!permissions?.can_edit_bookings;
  const canHandleRequests = privileged || !!permissions?.can_handle_requests;
  const canDelete = privileged;

  // Segment / status / cleaner come from the URL (deep-linkable, Back-restorable).
  // Search stays transient local state, so typing doesn't spam the history.
  const segParam = searchParams.get("segment");
  const segment: BookingSegment =
    segParam && VALID_SEGMENTS.has(segParam) ? (segParam as BookingSegment) : DEFAULT_SEGMENT;
  const statusParam = searchParams.get("status");
  const statusFilter: StatusFilter =
    statusParam && VALID_STATUSES.has(statusParam as StatusFilter) ? (statusParam as StatusFilter) : "all";
  const cleanerFilter = searchParams.get("cleaner") || "all";

  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);

  // Write a filter to the URL (replace, so filter tweaks don't stack history),
  // preserving sibling params like ?booking. Defaults are dropped for clean URLs.
  const setFilterParam = useCallback(
    (key: string, value: string, isDefault: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (isDefault) params.delete(key);
      else params.set(key, value);
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [searchParams, router],
  );
  const setSegment = useCallback(
    (v: BookingSegment) => setFilterParam("segment", v, v === DEFAULT_SEGMENT),
    [setFilterParam],
  );
  const setStatusFilter = useCallback(
    (v: StatusFilter) => setFilterParam("status", v, v === "all"),
    [setFilterParam],
  );
  const setCleanerFilter = useCallback(
    (v: string) => setFilterParam("cleaner", v, v === "all"),
    [setFilterParam],
  );

  const today = useMemo(() => localISODate(new Date()), []);

  // Row click just sets ?booking=<id>; the shell-level OperatorBookingDetailHost
  // owns the param and renders the sheet.
  const openDetail = useCallback((id: string) => setBookingParam(id), [setBookingParam]);

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

  // --- confirm dialog (single + bulk cancel/delete) ---
  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    const { kind, ids } = confirm;
    setBusy(true);
    try {
      if (kind === "cancel") {
        const r = await cancelAppointment(ids[0]);
        await refetch();
        if (r.success) { toast.success("Booking cancelled"); }
        else { toast.error(r.error || "Could not cancel"); }
      } else if (kind === "delete") {
        const r = await deleteAppointment(ids[0]);
        await refetch();
        if (r.success) { toast.success("Booking deleted"); }
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
  }, [confirm, refetch, clearSelection]);

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
        return { title: "Cancel this booking?", description: "This can't be undone.", confirmLabel: "Cancel booking", destructive: false };
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
