"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/contexts/ToastContext";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
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
import { OperatorCustomersView, type CustomerStats } from "./OperatorCustomersView";
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
 * Hook-backed Operator Customers. Consumes the existing headless admin hooks
 * (useAdminCustomers list + useCustomerDetails for the open sheet) and the
 * customer mutation helpers unchanged, derives the filtered/sorted list, and
 * drives the presentational View, detail Sheet, invite dialog, and confirm
 * dialog. Customers have no time lifecycle, so the list is sorted (not
 * segmented). Adding a customer sends a homeowner invite.
 */
export function OperatorCustomers() {
  const { showToast } = useToast();
  const { currentOrgRole, currentOrganizationId, accessToken } = useAuth();
  const { customers, loading, refetch, updateCustomerInState } = useAdminCustomers();
  const { permissions } = useManagerPermissions();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canViewPayments = privileged || !!permissions?.can_view_payments;
  const canEdit = privileged || !!permissions?.can_edit_customers;

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

  const derived = useMemo(() => deriveCustomers(customers, { search, sort }), [customers, search, sort]);
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

  const stats: CustomerStats = useMemo(() => {
    const totalRevenue = customers.reduce((s, c) => s + (c.total_spent ?? 0), 0);
    const totalAppointments = customers.reduce((s, c) => s + (c.appointments_count ?? 0), 0);
    return {
      totalCustomers: customers.length,
      totalRevenueLabel: canViewPayments ? money0(totalRevenue) : null,
      totalAppointments,
    };
  }, [customers, canViewPayments]);

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

  // --- detail open/close ---
  const openDetail = useCallback((id: string) => {
    setEditing(false);
    setDetailId(id);
  }, []);
  const closeDetail = useCallback(() => {
    setEditing(false);
    setDetailId(null);
  }, []);

  // --- mutations ---
  const handleSave = useCallback(
    async (fields: CustomerSaveFields): Promise<boolean> => {
      if (!detailId) return false;
      setBusy(true);
      try {
        const r = await updateCustomer(detailId, fields);
        if (r.success) {
          updateCustomerInState(detailId, fields);
          showToast("Customer updated", { variant: "success" });
          return true;
        }
        showToast(r.error || "Could not update the customer", { variant: "error" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [detailId, updateCustomerInState, showToast],
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
          showToast("Invite sent", {
            variant: "success",
            description: `${email} will appear here once they accept.`,
          });
          return true;
        }
        showToast(r.error || "Could not send the invite", { variant: "error" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, accessToken, showToast],
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
          showToast("Customer deleted", { variant: "success" });
          closeDetail();
        } else {
          showToast(r.error || "Could not delete the customer", { variant: "error" });
        }
      } else if (kind === "bulkDelete") {
        const r = await deleteCustomers(ids, currentOrganizationId);
        await refetch();
        if (!r.success) {
          showToast(r.error || "Could not delete the customers", { variant: "error" });
        } else {
          const summary = describeCustomerDelete(r.results ?? []);
          showToast(summary.message, { variant: summary.variant });
        }
        clearSelection();
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, currentOrganizationId, refetch, showToast, clearSelection, closeDetail]);

  const handleRowAction = useCallback(
    (id: string, action: CustomerRowAction) => {
      if (action === "open") openDetail(id);
      else if (action === "edit") {
        setDetailId(id);
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
        rows={rows}
        stats={stats}
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
