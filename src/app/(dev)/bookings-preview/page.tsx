"use client";

import { useMemo, useState } from "react";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorBookingsView } from "@/components/redesign/bookings/OperatorBookingsView";
import { BookingDetailSheet } from "@/components/redesign/bookings/BookingDetailSheet";
import type {
  BookingDetailVM,
  BookingRowVM,
  BookingSegment,
  StatusFilter,
} from "@/components/redesign/bookings/bookings-types";

// TEMPORARY dev-only preview (gated by the (dev) layout) so the presentational
// Bookings View can be iterated on without auth/hooks. The live screen is at
// /app/admin-dashboard/bookings via the hook-backed OperatorBookings.

const CLEANERS = [
  { id: "marco", name: "Marco Diaz" },
  { id: "sara", name: "Sara Kim" },
  { id: "priya", name: "Priya Rao" },
];

const ROWS: BookingRowVM[] = [
  {
    id: "1", dateLabel: "Jun 22", weekdayLabel: "Mon", timeLabel: "8:00am", isToday: true,
    customer: "Jane Smith", property: "123 Maple Ave", service: "Standard clean", durationLabel: "2h",
    cleaner: "Marco Diaz", cleanerAvatarUrl: null, status: "confirmed", badge: "confirmed",
    payment: { tone: "paid", label: "Paid" }, isUnassigned: false, isSelfPay: false,
  },
  {
    id: "2", dateLabel: "Jun 22", weekdayLabel: "Mon", timeLabel: "10:30am", isToday: true,
    customer: "Aaron Lee", property: "88 Oak St", service: "Deep clean", durationLabel: "3h",
    cleaner: null, cleanerAvatarUrl: null, status: "pending", badge: "unassigned",
    payment: { tone: "none", label: "Unpaid" }, isUnassigned: true, isSelfPay: false,
  },
  {
    id: "3", dateLabel: "Jun 22", weekdayLabel: "Mon", timeLabel: "9:15am", isToday: true,
    customer: "Nadia Patel", property: "5 Pine St", service: "Standard clean", durationLabel: "2h",
    cleaner: "Sara Kim", cleanerAvatarUrl: null, status: "in_progress", badge: "in_progress",
    payment: { tone: "paid", label: "Paid" }, isUnassigned: false, isSelfPay: false,
  },
  {
    id: "4", dateLabel: "Jun 25", weekdayLabel: "Thu", timeLabel: "1:00pm", isToday: false,
    customer: "Self-pay booking", property: "240 Cedar Ct", service: "Move-out clean", durationLabel: "4h",
    cleaner: "Priya Rao", cleanerAvatarUrl: null, status: "confirmed", badge: "confirmed",
    payment: { tone: "selfpay", label: "Self-pay" }, isUnassigned: false, isSelfPay: true,
  },
  {
    id: "5", dateLabel: "Jun 26", weekdayLabel: "Fri", timeLabel: "2:00pm", isToday: false,
    customer: "Tom Reyes", property: "17 Birch Ln", service: "Standard clean", durationLabel: "2h",
    cleaner: "Marco Diaz", cleanerAvatarUrl: null, status: "pending", badge: "counter_proposed",
    payment: { tone: "pending", label: "Pending" }, isUnassigned: false, isSelfPay: false,
  },
  {
    id: "6", dateLabel: "Jun 18", weekdayLabel: "Wed", timeLabel: "11:00am", isToday: false,
    customer: "Grace Hall", property: "9 Elm Ave", service: "Deep clean", durationLabel: "3h",
    cleaner: "Sara Kim", cleanerAvatarUrl: null, status: "completed", badge: "completed",
    payment: { tone: "paid", label: "Paid" }, isUnassigned: false, isSelfPay: false,
  },
  {
    id: "7", dateLabel: "Jun 15", weekdayLabel: "Sun", timeLabel: "3:30pm", isToday: false,
    customer: "Omar Said", property: "61 Walnut Dr", service: "Standard clean", durationLabel: "2h",
    cleaner: "Priya Rao", cleanerAvatarUrl: null, status: "cancelled", badge: "cancelled",
    payment: { tone: "refunded", label: "Refunded" }, isUnassigned: false, isSelfPay: false,
  },
];

function inSegment(r: BookingRowVM, seg: BookingSegment): boolean {
  const pc = r.status === "pending" || r.status === "confirmed";
  switch (seg) {
    case "active": return r.status === "in_progress";
    case "today": return r.isToday && pc;
    case "upcoming": return !r.isToday && pc;
    case "past": return r.status === "completed" || r.status === "cancelled";
    default: return true;
  }
}

const DETAIL: BookingDetailVM = {
  id: "5", title: "17 Birch Ln", service: "Standard clean",
  dateLabel: "Friday, June 26", timeLabel: "2:00pm", durationLabel: "2h",
  status: "pending", badge: "counter_proposed",
  customer: "Tom Reyes", customerEmail: "tom@example.com", customerId: "tom", isSelfPay: false,
  cleaner: "Marco Diaz", cleanerId: "marco", cleanerAvatarUrl: null,
  payment: { tone: "pending", label: "Pending" }, priceLabel: "$120.00",
  specialRequests: "Please use the side gate and watch for the dog.", notes: null,
  isUnassigned: false,
  counterProposals: [
    { id: "p1", label: "Jun 27 at 9:00am", date: "2026-06-27", time: "09:00:00" },
    { id: "p2", label: "Jun 28 at 1:00pm", date: "2026-06-28", time: "13:00:00" },
  ],
  counterWindows: [
    {
      id: "w1",
      label: "Jun 29, 8:00am to 12:00pm",
      date: "2026-06-29",
      startTime: "08:00:00",
      endTime: "12:00:00",
    },
  ],
  declinedReason: null,
};

export default function BookingsPreviewPage() {
  const [segment, setSegment] = useState<BookingSegment>("upcoming");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [cleanerFilter, setCleanerFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailOpen, setDetailOpen] = useState(false);

  const counts = useMemo(
    () => ({
      today: ROWS.filter((r) => inSegment(r, "today")).length,
      upcoming: ROWS.filter((r) => inSegment(r, "upcoming")).length,
      active: ROWS.filter((r) => inSegment(r, "active")).length,
      past: ROWS.filter((r) => inSegment(r, "past")).length,
      all: ROWS.length,
    }),
    [],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ROWS.filter(
      (r) =>
        inSegment(r, segment) &&
        (!q || `${r.customer} ${r.property} ${r.cleaner ?? ""} ${r.service}`.toLowerCase().includes(q)) &&
        (statusFilter === "all" || r.status === statusFilter) &&
        (cleanerFilter === "all" ||
          (cleanerFilter === "unassigned" ? r.isUnassigned : r.cleaner === CLEANERS.find((c) => c.id === cleanerFilter)?.name)),
    );
  }, [segment, search, statusFilter, cleanerFilter]);

  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <OperatorShell active="bookings" onNewBooking={() => {}}>
      <OperatorBookingsView
        rows={rows}
        counts={counts}
        totalCount={ROWS.length}
        canViewPayments
        canEdit
        canHandleRequests
        canDelete
        segment={segment}
        onSegmentChange={setSegment}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        cleanerFilter={cleanerFilter}
        onCleanerFilterChange={setCleanerFilter}
        cleanerOptions={CLEANERS}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={() =>
          setSelectedIds((prev) =>
            rows.length > 0 && rows.every((r) => prev.has(r.id))
              ? new Set()
              : new Set(rows.map((r) => r.id)),
          )
        }
        onClearSelection={() => setSelectedIds(new Set())}
        onOpenRow={() => setDetailOpen(true)}
        onRowAction={(_id, action) => {
          if (action === "open" || action === "assign") setDetailOpen(true);
        }}
        onBulkCancel={() => setSelectedIds(new Set())}
        onBulkDelete={() => setSelectedIds(new Set())}
        onNewBooking={() => {}}
      />
      <BookingDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        detail={DETAIL}
        appointment={null}
        cleanerOptions={CLEANERS}
        canViewPayments
        canManagePayments
        canEdit
        canHandleRequests
        canDelete
        onAssign={() => {}}
        onAcceptCounter={() => {}}
        onStart={() => {}}
        onComplete={() => {}}
        onOpenReschedule={() => {}}
        onCancel={() => {}}
        onDelete={() => {}}
        onMessageCustomer={() => {}}
        onMessageCleaner={() => {}}
      />
    </OperatorShell>
  );
}
