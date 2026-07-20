"use client";

import { useMemo, useState } from "react";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorCustomersView } from "@/components/redesign/customers/OperatorCustomersView";
import { CustomerDetailSheet } from "@/components/redesign/customers/CustomerDetailSheet";
import { AddCustomerDialog } from "@/components/redesign/customers/AddCustomerDialog";
import { deriveCustomers, type CustomersCustomer } from "@/components/redesign/customers/deriveCustomers";
import type {
  CustomerDetailVM,
  CustomerHistoryVM,
  CustomerPropertyVM,
  CustomerRowVM,
  CustomerSort,
} from "@/components/redesign/customers/customers-types";

// TEMPORARY dev-only preview (gated by the (dev) layout) so the presentational
// Customers View + detail Sheet can be iterated on without auth/hooks. The live
// screen is at /admin/customers via the hook-backed
// OperatorCustomers.

type MockCustomer = CustomersCustomer & {
  id: string;
  avatar_url: string | null;
  properties_count: number;
  appointments_count: number;
};

const CUSTOMERS: MockCustomer[] = [
  {
    id: "1", first_name: "Jane", last_name: "Smith", email: "jane@example.com", phone: "(512) 555-0100",
    avatar_url: null, created_at: "2025-08-12T00:00:00Z", total_spent: 1240, last_appointment_date: "2026-06-12",
    properties_count: 2, appointments_count: 9,
  },
  {
    id: "2", first_name: "Aaron", last_name: "Lee", email: "aaron@acme.test", phone: null,
    avatar_url: null, created_at: "2026-01-04T00:00:00Z", total_spent: 320, last_appointment_date: "2026-06-20",
    properties_count: 1, appointments_count: 3,
  },
  {
    id: "3", first_name: "Nadia", last_name: "Patel", email: "nadia.patel@example.com", phone: "(512) 555-0142",
    avatar_url: null, created_at: "2024-11-30T00:00:00Z", total_spent: 4860, last_appointment_date: "2026-06-18",
    properties_count: 3, appointments_count: 27,
  },
  {
    id: "4", first_name: null, last_name: null, email: "newhomeowner@example.com", phone: null,
    avatar_url: null, created_at: "2026-06-19T00:00:00Z", total_spent: 0, last_appointment_date: null,
    properties_count: 0, appointments_count: 0,
  },
];

function money0(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
function monthYear(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function monthDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function nameOf(c: MockCustomer) {
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email;
}
function initials(c: MockCustomer) {
  const name = nameOf(c);
  if (name === c.email) return c.email[0].toUpperCase();
  const p = name.split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

function toRow(c: MockCustomer): CustomerRowVM {
  return {
    id: c.id, name: nameOf(c), email: c.email, phone: c.phone ?? null, avatarUrl: c.avatar_url,
    initials: initials(c), sinceLabel: monthYear(c.created_at),
    propertiesCount: c.properties_count, appointmentsCount: c.appointments_count,
    totalSpentLabel: money0(c.total_spent ?? 0),
    lastServiceLabel: c.last_appointment_date ? `Last booking ${monthDay(c.last_appointment_date)}` : null,
  };
}

const PROPERTIES: CustomerPropertyVM[] = [
  { id: "p1", name: "Main residence", address: "123 Maple Ave, Austin, TX 78701", metaLabel: "3 bd · 2 ba · 1,800 sqft" },
  { id: "p2", name: "Lake house", address: "9 Shoreline Dr, Austin, TX 78732", metaLabel: "4 bd · 3 ba · 2,600 sqft" },
];

const HISTORY: CustomerHistoryVM[] = [
  { id: "h1", dateLabel: "Jun 12, 2026", service: "Standard clean", property: "123 Maple Ave", status: "completed", priceLabel: "$120.00" },
  { id: "h2", dateLabel: "Jun 26, 2026", service: "Deep clean", property: "9 Shoreline Dr", status: "confirmed", priceLabel: "$240.00" },
  { id: "h3", dateLabel: "May 28, 2026", service: "Standard clean", property: "123 Maple Ave", status: "completed", priceLabel: "$120.00" },
];

const DETAIL: CustomerDetailVM = {
  id: "1", name: "Jane Smith", email: "jane@example.com", phone: "(512) 555-0100", avatarUrl: null,
  initials: "JS", sinceLabel: "Aug 2025", propertiesCount: 2, appointmentsCount: 9,
  totalSpentLabel: "$1,240", firstName: "Jane", lastName: "Smith",
};

export default function CustomersPreviewPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CustomerSort>("recent");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(
    () => deriveCustomers(CUSTOMERS, { search, sort }).map(toRow),
    [search, sort],
  );

  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <OperatorShell active="people" onNewBooking={() => {}}>
      <OperatorCustomersView
        rows={rows}
        totalCount={CUSTOMERS.length}
        canViewPayments
        canEdit
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
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
        onOpenRow={() => {
          setEditing(false);
          setDetailOpen(true);
        }}
        onRowAction={(_id, action) => {
          if (action === "delete") return;
          setEditing(action === "edit");
          setDetailOpen(true);
        }}
        onBulkDelete={() => setSelectedIds(new Set())}
        onNewCustomer={() => setAddOpen(true)}
      />

      <CustomerDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        detail={DETAIL}
        properties={PROPERTIES}
        history={HISTORY}
        detailsLoading={false}
        canViewPayments
        canEdit
        editing={editing}
        onEditingChange={setEditing}
        onSave={async () => true}
        onDelete={() => {}}
        onNewBooking={() => {}}
        onMessage={() => {}}
        onOpenBooking={() => {}}
      />

      <AddCustomerDialog open={addOpen} onOpenChange={setAddOpen} onInvite={async () => true} />
    </OperatorShell>
  );
}
