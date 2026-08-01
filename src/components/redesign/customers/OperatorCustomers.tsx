"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { replaceSearchShallow } from "@/lib/shallowSearch";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { useDetailParam } from "@/hooks/useDetailParam";
import { useOpenProperty } from "@/components/redesign/properties/useOpenProperty";
import { useOpenOperatorBooking } from "@/components/redesign/bookings/new-booking/useOpenOperatorBooking";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useAdminCustomers,
  useCustomerDetails,
  updateCustomer,
  deleteCustomer,
  deleteCustomers,
  inviteTeamMember,
  type AdminCustomer,
  type CustomerAppointment,
  type CustomerProperty,
  type DeleteCustomerResult,
} from "@/hooks/useAdminData";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OperatorCustomersView } from "./OperatorCustomersView";
import { CustomerDetailSheet, type CustomerSaveFields } from "./CustomerDetailSheet";
import { AddCustomerDialog } from "./AddCustomerDialog";
import { deriveCustomers } from "./deriveCustomers";
import type {
  CustomerDetailVM,
  CustomerHistoryStatus,
  CustomerHistoryVM,
  CustomerPropertyVM,
  CustomerRowAction,
  CustomerRowVM,
  CustomerSort,
} from "./customers-types";

// --- formatting helpers (AdminCustomer / details -> view-model) ---

function money0(n: number): string {
  return `$${Math.round(n || 0).toLocaleString("en-US")}`;
}
function money2(n: number): string {
  return `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function monthDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function longDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function nameOf(c: AdminCustomer): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return n || c.email;
}
function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return (email[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function toRowVM(c: AdminCustomer, canViewPayments: boolean): CustomerRowVM {
  const name = nameOf(c);
  const hasName = name !== c.email;
  return {
    id: c.id,
    name,
    email: c.email,
    phone: c.phone,
    avatarUrl: c.avatar_url,
    initials: initials(hasName ? name : "", c.email),
    sinceLabel: monthYear(c.created_at),
    propertiesCount: c.properties_count,
    appointmentsCount: c.appointments_count,
    totalSpentLabel: canViewPayments ? money0(c.total_spent) : null,
    lastServiceLabel: c.last_appointment_date ? `Last booking ${monthDay(c.last_appointment_date)}` : null,
  };
}

function toDetailVM(c: AdminCustomer, canViewPayments: boolean): CustomerDetailVM {
  const name = nameOf(c);
  const hasName = name !== c.email;
  return {
    id: c.id,
    name,
    email: c.email,
    phone: c.phone,
    avatarUrl: c.avatar_url,
    initials: initials(hasName ? name : "", c.email),
    sinceLabel: monthYear(c.created_at),
    propertiesCount: c.properties_count,
    appointmentsCount: c.appointments_count,
    totalSpentLabel: canViewPayments ? money0(c.total_spent) : null,
    firstName: c.first_name ?? "",
    lastName: c.last_name ?? "",
  };
}

function toPropertyVM(p: CustomerProperty): CustomerPropertyVM {
  const cityLine = [p.city, [p.state, p.zip_code].filter(Boolean).join(" ").trim()]
    .filter(Boolean)
    .join(", ");
  const address = [p.address, cityLine].filter(Boolean).join(", ");
  const meta = [
    p.bedrooms != null ? `${p.bedrooms} bd` : null,
    p.bathrooms != null ? `${p.bathrooms} ba` : null,
    p.square_feet != null ? `${p.square_feet.toLocaleString("en-US")} sqft` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { id: p.id, name: p.name || p.address || "Property", address, metaLabel: meta };
}

function toHistoryVM(a: CustomerAppointment, canViewPayments: boolean): CustomerHistoryVM {
  return {
    id: a.id,
    dateLabel: longDate(a.scheduled_date),
    service: a.service_type?.name || a.checklist?.name || "Cleaning",
    property: a.property?.name || a.property?.address || null,
    status: a.status as CustomerHistoryStatus,
    priceLabel: canViewPayments ? money2(a.total_price) : null,
  };
}

function describeCustomerDelete(results: DeleteCustomerResult[]): {
  message: string;
  variant: "success" | "error";
} {
  const deleted = results.filter((r) => r.status === "deleted").length;
  const blocked = results.filter((r) => r.status === "blocked").length;
  const errored = results.filter((r) => r.status === "error").length;
  const parts: string[] = [];
  if (deleted > 0) parts.push(`Deleted ${deleted} customer${deleted === 1 ? "" : "s"}`);
  if (blocked > 0) parts.push(`${blocked} kept (has booking history)`);
  if (errored > 0) parts.push(`${errored} failed`);
  return {
    message: parts.join(", ") || "No customers were deleted",
    variant: deleted > 0 ? "success" : "error",
  };
}

type ConfirmKind = "delete" | "bulkDelete";
type ConfirmState = { kind: ConfirmKind; ids: string[] } | null;

/**
 * Permission gate for the Operator Customers screen. Customer data (profiles,
 * contact, spend, history) is protected by an APP-LEVEL grant, not RLS (an org
 * member can query homeowner rows), so we must not even fetch it until we know
 * the viewer is allowed. The legacy dashboard achieved this by never mounting
 * the customers list for a manager without the permission; we mirror that by
 * keeping every data-fetching hook inside OperatorCustomersData, which only
 * renders once the permission resolves and grants access.
 */
export function OperatorCustomers() {
  const { currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canView = privileged || !!permissions?.can_view_customers;

  // Permissions not resolved yet: hold (and don't fetch) rather than flash the
  // access-denied state before the grant is known.
  if (!privileged && permsLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canView) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <EmptyState
          icon={<ShieldAlert />}
          title="You do not have access to customers"
          description="Ask an owner or admin to grant you the customers permission."
        />
      </div>
    );
  }

  return (
    <OperatorCustomersData
      canViewPayments={privileged || !!permissions?.can_view_payments}
      canEdit={privileged || !!permissions?.can_edit_customers}
      canViewProperties={privileged || !!permissions?.can_view_properties}
      canCreateBooking={privileged || !!permissions?.can_edit_bookings}
      canViewBookings={privileged || !!permissions?.can_view_bookings}
    />
  );
}

/**
 * Data + behavior for the Customers screen. Only mounted for a viewer allowed to
 * see customers, so the useAdminCustomers / useCustomerDetails fetches never run
 * for an unauthorized manager. Consumes the existing headless hooks and mutation
 * helpers unchanged; customers have no time lifecycle, so the list is sorted
 * (not segmented). Adding a customer sends a homeowner invite.
 */
function OperatorCustomersData({
  canViewPayments,
  canEdit,
  canViewProperties,
  canCreateBooking,
  canViewBookings,
}: {
  canViewPayments: boolean;
  canEdit: boolean;
  canViewProperties: boolean;
  canCreateBooking: boolean;
  canViewBookings: boolean;
}) {
  const { currentOrganizationId, accessToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { customers, loading, error, refetch, updateCustomerInState } = useAdminCustomers();
  const { paramId: customerParam, setParam: setCustomerParam } = useDetailParam("customer");
  const { open: openProperty } = useOpenProperty();
  const openNewBooking = useOpenOperatorBooking();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CustomerSort>("recent");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);

  const {
    appointments: detailAppointments,
    properties: detailProperties,
    loading: detailsLoading,
  } = useCustomerDetails(detailId);

  // Don't let spend ordering leak when payments are hidden: fall back to the
  // recent sort (the View also hides the "Top spenders" option in that case).
  const effectiveSort: CustomerSort = !canViewPayments && sort === "spent" ? "recent" : sort;
  const derived = useMemo(
    () => deriveCustomers(customers, { search, sort: effectiveSort }),
    [customers, search, effectiveSort],
  );
  const rows: CustomerRowVM[] = useMemo(
    () => derived.map((c) => toRowVM(c, canViewPayments)),
    [derived, canViewPayments],
  );

  // Keep the selection scoped to what is currently visible, so a hidden
  // customer can never be caught by a bulk delete.
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
    const c = customers.find((x) => x.id === detailId);
    return c ? toDetailVM(c, canViewPayments) : null;
  }, [detailId, customers, canViewPayments]);

  const detailPropertiesVM = useMemo(
    () => detailProperties.map(toPropertyVM),
    [detailProperties],
  );
  const detailHistoryVM = useMemo(
    () => detailAppointments.map((a) => toHistoryVM(a, canViewPayments)),
    [detailAppointments, canViewPayments],
  );

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

  // --- detail open/close (URL-synced for deep links) ---
  const openDetail = useCallback(
    (id: string) => {
      setEditing(false);
      setDetailId(id);
      setCustomerParam(id);
    },
    [setCustomerParam],
  );
  const closeDetail = useCallback(() => {
    setEditing(false);
    setDetailId(null);
    setCustomerParam(null);
  }, [setCustomerParam]);

  // --- customer quick actions (all target the customer whose sheet is open) ---
  // Seed a new booking for this customer. useOpenOperatorBooking replaces the
  // whole query string, so ?customer drops and the customer sheet closes as the
  // global new-booking host takes over.
  const handleNewBookingForCustomer = useCallback(() => {
    if (detailId) openNewBooking({ customerId: detailId });
  }, [detailId, openNewBooking]);

  const handleMessageCustomer = useCallback(() => {
    if (detailId) router.push(`/admin/messages?to=${detailId}`);
  }, [detailId, router]);

  // Swap the customer sheet for the booking sheet in ONE navigation so they
  // never stack: drop ?customer, set ?booking (the global booking-detail host,
  // mounted when canViewBookings, opens it in place).
  const openBookingFromCustomer = useCallback(
    (appointmentId: string) => {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("customer");
      sp.set("booking", appointmentId);
      replaceSearchShallow(`${pathname}?${sp.toString()}`);
    },
    [pathname],
  );

  // Keep the detail in sync with the `?customer=<id>` deep link: open it when the
  // param is present and close it when the param is removed (e.g. browser Back).
  useEffect(() => {
    setDetailId(customerParam);
  }, [customerParam]);

  // --- mutations ---
  const handleSave = useCallback(
    async (fields: CustomerSaveFields): Promise<boolean> => {
      if (!detailId) return false;
      setBusy(true);
      try {
        const r = await updateCustomer(detailId, fields);
        if (r.success) {
          updateCustomerInState(detailId, fields);
          toast.success("Customer updated");
          return true;
        }
        toast.error(r.error || "Could not update the customer");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [detailId, updateCustomerInState],
  );

  const handleInvite = useCallback(
    async (email: string): Promise<boolean> => {
      if (!currentOrganizationId) return false;
      setBusy(true);
      try {
        const r = await inviteTeamMember({
          email,
          role: "homeowner",
          organizationId: currentOrganizationId,
          accessToken,
        });
        if (r.success) {
          toast.success("Invite sent", { description: `${email} will appear here once they accept.` });
          return true;
        }
        toast.error(r.error || "Could not send the invite");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, accessToken],
  );

  const runConfirm = useCallback(async () => {
    if (!confirm || !currentOrganizationId) return;
    const { kind, ids } = confirm;
    setBusy(true);
    try {
      if (kind === "delete") {
        const r = await deleteCustomer(ids[0], currentOrganizationId);
        await refetch();
        if (r.success) {
          toast.success("Customer deleted");
          closeDetail();
        } else {
          toast.error(r.error || "Could not delete the customer");
        }
      } else if (kind === "bulkDelete") {
        const r = await deleteCustomers(ids, currentOrganizationId);
        await refetch();
        if (!r.success) {
          toast.error(r.error || "Could not delete the customers");
        } else {
          const summary = describeCustomerDelete(r.results ?? []);
          if (summary.variant === "success") { toast.success(summary.message); } else { toast.error(summary.message); }
        }
        clearSelection();
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, currentOrganizationId, refetch, clearSelection, closeDetail]);

  const handleRowAction = useCallback(
    (id: string, action: CustomerRowAction) => {
      if (action === "open") openDetail(id);
      else if (action === "edit") {
        openDetail(id);
        setEditing(true);
      } else if (action === "delete") setConfirm({ kind: "delete", ids: [id] });
    },
    [openDetail],
  );

  const confirmCopy = useMemo(() => {
    if (!confirm) return null;
    const n = confirm.ids.length;
    if (confirm.kind === "delete") {
      return {
        title: "Delete this customer?",
        description:
          "This removes their profile and account access. A customer with booking or invoice history cannot be deleted.",
        confirmLabel: "Delete",
      };
    }
    return {
      title: `Delete ${n} customer${n === 1 ? "" : "s"}?`,
      description:
        "This removes their profiles and account access. Any with booking or invoice history will be kept.",
      confirmLabel: "Delete",
    };
  }, [confirm]);

  return (
    <>
      <OperatorCustomersView
        loading={loading}
        error={Boolean(error)}
        onRetry={() => refetch()}
        rows={rows}
        totalCount={customers.length}
        canViewPayments={canViewPayments}
        canEdit={canEdit}
        bulkBusy={busy}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        onClearSelection={clearSelection}
        onOpenRow={openDetail}
        onRowAction={handleRowAction}
        onBulkDelete={() => setConfirm({ kind: "bulkDelete", ids: [...selectedIds] })}
        onNewCustomer={() => setAddOpen(true)}
      />

      <CustomerDetailSheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) closeDetail();
        }}
        detail={detail}
        properties={detailPropertiesVM}
        history={detailHistoryVM}
        detailsLoading={detailsLoading}
        canViewPayments={canViewPayments}
        canEdit={canEdit}
        busy={busy}
        editing={editing}
        onEditingChange={setEditing}
        onSave={handleSave}
        onDelete={() => detail && setConfirm({ kind: "delete", ids: [detail.id] })}
        onOpenProperty={canViewProperties ? openProperty : undefined}
        onNewBooking={canCreateBooking ? handleNewBookingForCustomer : undefined}
        onMessage={handleMessageCustomer}
        onOpenBooking={canViewBookings ? openBookingFromCustomer : undefined}
      />

      <AddCustomerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        busy={busy}
        onInvite={handleInvite}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirmCopy?.title ?? ""}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        destructive
        loading={busy}
        onConfirm={runConfirm}
      />
    </>
  );
}
