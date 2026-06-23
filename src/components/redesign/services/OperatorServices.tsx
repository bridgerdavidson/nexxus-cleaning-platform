"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/contexts/ToastContext";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { keys } from "@/lib/queryKeys";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useServices,
  createService,
  updateService,
  deleteService,
  toggleServiceActive,
  canDeleteService,
  duplicateService,
  type ServiceType,
} from "@/hooks/useServices";
import {
  useChecklists,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  duplicateChecklist,
  createLineItem,
  createLineItems,
  updateLineItem,
  deleteLineItem,
  reorderLineItems,
  reorderChecklists,
  type ChecklistWithItems,
  type ChecklistLineItem,
} from "@/hooks/useChecklists";
import {
  filterServices,
  sortServices,
  sortChecklists,
  rowPriceLabel,
  priceRangeLabel,
  priceAdderLabel,
  formatPrice,
  formatDuration,
  serviceTypeLabel,
} from "./deriveServices";
import type {
  ServiceRowVM,
  ServiceDetailVM,
  ChecklistVM,
  ServiceSort,
  ServiceStatusFilter,
} from "./services-types";
import { OperatorServicesView } from "./OperatorServicesView";
import { ServiceFormDialog, type ServiceFormValues } from "./ServiceFormDialog";
import { ChecklistFormDialog } from "./ChecklistFormDialog";
import { DeleteServiceDialog } from "./DeleteServiceDialog";
import { DeleteChecklistDialog } from "./DeleteChecklistDialog";
import type { ServiceDetailHandlers } from "./ServiceDetailPane";

// --- record -> view-model ---

function toRowVM(s: ServiceType, maxAdder: number): ServiceRowVM {
  return {
    id: s.id,
    name: s.name,
    priceLabel: rowPriceLabel(Number(s.base_price) || 0, maxAdder),
    durationLabel: formatDuration(s.duration_minutes),
    serviceTypeLabel: serviceTypeLabel(s.service_type),
    isActive: s.is_active,
  };
}

function toDetailVM(s: ServiceType, maxAdder: number): ServiceDetailVM {
  const base = Number(s.base_price) || 0;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    basePrice: base,
    basePriceLabel: formatPrice(base),
    durationMinutes: s.duration_minutes,
    durationLabel: formatDuration(s.duration_minutes),
    serviceType: s.service_type,
    serviceTypeLabel: serviceTypeLabel(s.service_type),
    isActive: s.is_active,
    priceRangeLabel: priceRangeLabel(base, maxAdder),
  };
}

/**
 * Permission gate for the Operator Services screen. Owners/admins manage; a
 * manager manages only with `can_manage_services` and views (read-only) with
 * `can_view_services`. We resolve the grant before mounting the data component
 * so an unauthorized viewer never triggers the service/checklist fetches.
 */
export function OperatorServices() {
  const { currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canManage = privileged || !!permissions?.can_manage_services;
  const canView = canManage || !!permissions?.can_view_services;

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
          title="You do not have access to services"
          description="Ask an owner or admin to grant you the services permission."
        />
      </div>
    );
  }

  return <OperatorServicesData canManage={canManage} />;
}

function OperatorServicesData({ canManage }: { canManage: boolean }) {
  const { showToast } = useToast();
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? "";
  const queryClient = useQueryClient();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("service");

  const {
    services,
    loading,
    refetch,
    updateServiceInState,
    maxChecklistAdderByServiceId,
    refreshMaxChecklistAdders,
  } = useServices();

  const {
    checklists,
    loading: checklistsLoading,
    refetch: refetchChecklists,
    applyLineItemUpdated,
    applyLineItemRemoved,
    applyLineItemsReordered,
  } = useChecklists(selectedId);

  // --- selection (URL-persisted) ---
  const onSelect = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("service", id);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );
  const clearSelection = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("service");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  // --- toolbar state ---
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ServiceSort>("name");
  const [status, setStatus] = useState<ServiceStatusFilter>("active");

  // --- dialog state ---
  const [serviceDialog, setServiceDialog] = useState<{ mode: "create" | "edit" } | null>(null);
  const [checklistDialog, setChecklistDialog] = useState<
    { mode: "create" } | { mode: "edit"; checklistId: string } | null
  >(null);
  const [deleteServiceState, setDeleteServiceState] = useState<{
    id: string; name: string; canDelete: boolean; appointmentCount: number; seriesCount: number;
  } | null>(null);
  const [deleteChecklistState, setDeleteChecklistState] = useState<{
    id: string; name: string; itemCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // --- derived lists / view-models ---
  const derivedServices = useMemo(
    () => sortServices(filterServices(services, { search, status }), sort),
    [services, search, status, sort],
  );
  const rows = useMemo<ServiceRowVM[]>(
    () => derivedServices.map((s) => toRowVM(s, maxChecklistAdderByServiceId[s.id] ?? 0)),
    [derivedServices, maxChecklistAdderByServiceId],
  );
  const activeCount = useMemo(() => services.filter((s) => s.is_active).length, [services]);

  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedId) ?? null,
    [services, selectedId],
  );

  // The selected service's checklists are loaded, so derive its max add-on from
  // them (more accurate than the global map right after an edit).
  const liveMaxAdder = useMemo(
    () => checklists.reduce((m, c) => Math.max(m, Number(c.price_adder) || 0), 0),
    [checklists],
  );
  const detail = useMemo<ServiceDetailVM | null>(
    () => (selectedService ? toDetailVM(selectedService, liveMaxAdder) : null),
    [selectedService, liveMaxAdder],
  );
  const checklistVMs = useMemo<ChecklistVM[]>(
    () =>
      sortChecklists(checklists).map((c) => ({
        id: c.id,
        name: c.name,
        priceAdder: Number(c.price_adder) || 0,
        priceAdderLabel: priceAdderLabel(Number(c.price_adder) || 0),
        tasks: (c.checklist_line_items ?? []).map((i) => ({ id: i.id, task: i.task })),
      })),
    [checklists],
  );

  // Keep the selection valid. On desktop, auto-select the first service (on
  // mount, after a delete, or when the URL points at a service that no longer
  // exists) so the detail pane is never stranded empty. On mobile, drop a stale
  // ?service param rather than auto-opening detail, so the user lands on the list.
  // Validity is checked against the full services list (not the filtered rows),
  // so a selected service hidden by the status filter stays selected.
  useEffect(() => {
    if (loading) return;
    const validSelection = !!selectedId && services.some((s) => s.id === selectedId);
    if (validSelection) return;
    const isDesktop =
      typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    if (isDesktop && services.length > 0) {
      onSelect(services[0].id);
    } else if (selectedId) {
      clearSelection();
    }
  }, [loading, selectedId, services, onSelect, clearSelection]);

  // --- service mutations ---
  const serviceFormInitial = useMemo<ServiceFormValues | null>(() => {
    if (serviceDialog?.mode === "edit" && selectedService) {
      return {
        name: selectedService.name,
        description: selectedService.description ?? "",
        base_price: Number(selectedService.base_price) || 0,
        duration_minutes: selectedService.duration_minutes,
        service_type: selectedService.service_type,
        is_active: selectedService.is_active,
      };
    }
    return null;
  }, [serviceDialog, selectedService]);

  const handleServiceSubmit = useCallback(
    async (v: ServiceFormValues) => {
      setBusy(true);
      try {
        if (serviceDialog?.mode === "edit" && selectedService) {
          const r = await updateService(selectedService.id, v, orgId);
          if (r.success) {
            showToast("Service updated", { variant: "success" });
            setServiceDialog(null);
          } else {
            showToast(r.error || "Could not update the service", { variant: "error" });
          }
        } else {
          const r = await createService(orgId, v);
          if (r.success && r.data) {
            showToast("Service created", { variant: "success" });
            setServiceDialog(null);
            await refetch();
            refreshMaxChecklistAdders();
            onSelect(r.data.id);
          } else {
            showToast(r.error || "Could not create the service", { variant: "error" });
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [serviceDialog, selectedService, orgId, showToast, refetch, refreshMaxChecklistAdders, onSelect],
  );

  const handleDuplicateService = useCallback(async () => {
    if (!selectedService) return;
    setBusy(true);
    try {
      const r = await duplicateService(orgId, selectedService.id);
      if (r.success && r.data) {
        showToast("Service duplicated", { variant: "success" });
        await refetch();
        refreshMaxChecklistAdders();
        onSelect(r.data.id);
      } else {
        showToast(r.error || "Could not duplicate the service", { variant: "error" });
      }
    } finally {
      setBusy(false);
    }
  }, [selectedService, orgId, showToast, refetch, refreshMaxChecklistAdders, onSelect]);

  const handleToggleActive = useCallback(
    async (next: boolean) => {
      if (!selectedService) return;
      updateServiceInState(selectedService.id, { is_active: next });
      const r = await toggleServiceActive(selectedService.id, next, orgId);
      if (!r.success) {
        updateServiceInState(selectedService.id, { is_active: !next });
        showToast(r.error || "Could not update the service", { variant: "error" });
      }
    },
    [selectedService, orgId, updateServiceInState, showToast],
  );

  const handleDeleteServiceClick = useCallback(async () => {
    if (!selectedService) return;
    const c = await canDeleteService(selectedService.id);
    setDeleteServiceState({ id: selectedService.id, name: selectedService.name, ...c });
  }, [selectedService]);

  const handleConfirmDeleteService = useCallback(async () => {
    if (!deleteServiceState) return;
    setBusy(true);
    try {
      const r = await deleteService(deleteServiceState.id);
      if (r.success) {
        showToast("Service deleted", { variant: "success" });
        setDeleteServiceState(null);
        clearSelection();
        await refetch();
        refreshMaxChecklistAdders();
      } else {
        showToast(r.error || "Could not delete the service", { variant: "error" });
      }
    } finally {
      setBusy(false);
    }
  }, [deleteServiceState, showToast, clearSelection, refetch, refreshMaxChecklistAdders]);

  // --- checklist mutations ---
  const checklistFormInitial = useMemo<{ name: string; price_adder: number } | null>(() => {
    if (checklistDialog?.mode === "edit") {
      const cl = checklists.find((c) => c.id === checklistDialog.checklistId);
      return cl ? { name: cl.name, price_adder: Number(cl.price_adder) || 0 } : null;
    }
    return null;
  }, [checklistDialog, checklists]);

  const handleChecklistSubmit = useCallback(
    async (v: { name: string; price_adder: number }) => {
      if (!selectedId) return;
      setBusy(true);
      try {
        if (checklistDialog?.mode === "edit") {
          const r = await updateChecklist(checklistDialog.checklistId, v.name, v.price_adder);
          if (r.success) {
            showToast("Checklist updated", { variant: "success" });
            setChecklistDialog(null);
            await refetchChecklists();
            refreshMaxChecklistAdders();
          } else {
            showToast(r.error || "Could not update the checklist", { variant: "error" });
          }
        } else {
          const r = await createChecklist(selectedId, v.name, v.price_adder);
          if (r.success) {
            showToast("Checklist added", { variant: "success" });
            setChecklistDialog(null);
            await refetchChecklists();
            refreshMaxChecklistAdders();
          } else {
            showToast(r.error || "Could not add the checklist", { variant: "error" });
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [selectedId, checklistDialog, showToast, refetchChecklists, refreshMaxChecklistAdders],
  );

  const handleDuplicateChecklist = useCallback(
    async (checklistId: string) => {
      const r = await duplicateChecklist(checklistId);
      if (r.success) {
        await refetchChecklists();
        refreshMaxChecklistAdders();
        showToast("Checklist duplicated", { variant: "success" });
      } else {
        showToast(r.error || "Could not duplicate the checklist", { variant: "error" });
      }
    },
    [refetchChecklists, refreshMaxChecklistAdders, showToast],
  );

  const handleDeleteChecklistClick = useCallback(
    (checklistId: string) => {
      const cl = checklists.find((c) => c.id === checklistId);
      if (!cl) return;
      setDeleteChecklistState({ id: cl.id, name: cl.name, itemCount: cl.checklist_line_items?.length ?? 0 });
    },
    [checklists],
  );

  const handleConfirmDeleteChecklist = useCallback(async () => {
    if (!deleteChecklistState) return;
    setBusy(true);
    try {
      const r = await deleteChecklist(deleteChecklistState.id);
      if (r.success) {
        showToast("Checklist deleted", { variant: "success" });
        setDeleteChecklistState(null);
        await refetchChecklists();
        refreshMaxChecklistAdders();
      } else {
        showToast(r.error || "Could not delete the checklist", { variant: "error" });
      }
    } finally {
      setBusy(false);
    }
  }, [deleteChecklistState, showToast, refetchChecklists, refreshMaxChecklistAdders]);

  // --- task mutations ---
  const handleAddTasks = useCallback(
    async (checklistId: string, raw: string) => {
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        showToast("Enter at least one task", { variant: "error" });
        return;
      }
      const r = lines.length === 1
        ? await createLineItem(checklistId, lines[0])
        : await createLineItems(checklistId, lines);
      if (r.success) await refetchChecklists();
      else showToast(r.error || "Could not add the task", { variant: "error" });
    },
    [refetchChecklists, showToast],
  );

  const handleSaveTask = useCallback(
    async (taskId: string, task: string) => {
      applyLineItemUpdated(taskId, task);
      const r = await updateLineItem(taskId, task);
      if (!r.success) {
        await refetchChecklists();
        showToast(r.error || "Could not update the task", { variant: "error" });
      }
    },
    [applyLineItemUpdated, refetchChecklists, showToast],
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      applyLineItemRemoved(taskId);
      const r = await deleteLineItem(taskId);
      if (!r.success) {
        await refetchChecklists();
        showToast(r.error || "Could not delete the task", { variant: "error" });
      }
    },
    [applyLineItemRemoved, refetchChecklists, showToast],
  );

  const handleReorderTasks = useCallback(
    async (checklistId: string, orderedIds: string[]) => {
      const cl = checklists.find((c) => c.id === checklistId);
      const prevItems = cl?.checklist_line_items ?? [];
      const byId = new Map(prevItems.map((i) => [i.id, i]));
      const nextItems: ChecklistLineItem[] = orderedIds
        .map((id) => byId.get(id))
        .filter((it): it is ChecklistLineItem => it !== undefined)
        .map((it, idx) => ({ ...it, position: idx }));
      applyLineItemsReordered(checklistId, nextItems);
      const r = await reorderLineItems(checklistId, orderedIds);
      if (!r.success) {
        await refetchChecklists();
        showToast(r.error || "Could not reorder tasks", { variant: "error" });
      }
    },
    [checklists, applyLineItemsReordered, refetchChecklists, showToast],
  );

  const handleReorderChecklists = useCallback(
    async (orderedIds: string[]) => {
      if (!selectedId) return;
      const key = keys.checklists.byServiceType(selectedId);
      const prev = queryClient.getQueryData<ChecklistWithItems[]>(key);
      if (prev) {
        const byId = new Map(prev.map((c) => [c.id, c]));
        const reordered: ChecklistWithItems[] = orderedIds
          .map((id) => byId.get(id))
          .filter((c): c is ChecklistWithItems => c !== undefined)
          .map((c, idx) => ({ ...c, position: idx }));
        queryClient.setQueryData(key, reordered);
      }
      const r = await reorderChecklists(selectedId, orderedIds);
      if (!r.success) {
        await refetchChecklists();
        showToast(r.error || "Could not reorder checklists", { variant: "error" });
      }
    },
    [selectedId, queryClient, refetchChecklists, showToast],
  );

  const detailHandlers: ServiceDetailHandlers = {
    onBack: clearSelection,
    onEdit: () => setServiceDialog({ mode: "edit" }),
    onToggleActive: handleToggleActive,
    onDuplicateService: handleDuplicateService,
    onDeleteService: handleDeleteServiceClick,
    onReorderChecklists: handleReorderChecklists,
    onAddChecklist: () => setChecklistDialog({ mode: "create" }),
    onAddTasks: handleAddTasks,
    onSaveTask: handleSaveTask,
    onDeleteTask: handleDeleteTask,
    onReorderTasks: handleReorderTasks,
    onEditChecklist: (checklistId) => setChecklistDialog({ mode: "edit", checklistId }),
    onDuplicateChecklist: handleDuplicateChecklist,
    onDeleteChecklist: handleDeleteChecklistClick,
  };

  return (
    <>
      <OperatorServicesView
        loading={loading}
        rows={rows}
        totalCount={services.length}
        activeCount={activeCount}
        canManage={canManage}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        status={status}
        onStatusChange={setStatus}
        selectedId={selectedId}
        onSelect={onSelect}
        onNewService={() => setServiceDialog({ mode: "create" })}
        detail={detail}
        checklists={checklistVMs}
        checklistsLoading={!!selectedId && checklistsLoading}
        detailHandlers={detailHandlers}
      />

      <ServiceFormDialog
        open={serviceDialog !== null}
        onOpenChange={(o) => { if (!o) setServiceDialog(null); }}
        busy={busy}
        initial={serviceFormInitial}
        onSubmit={handleServiceSubmit}
      />

      <ChecklistFormDialog
        open={checklistDialog !== null}
        onOpenChange={(o) => { if (!o) setChecklistDialog(null); }}
        busy={busy}
        initial={checklistFormInitial}
        onSubmit={handleChecklistSubmit}
      />

      <DeleteServiceDialog
        open={deleteServiceState !== null}
        onOpenChange={(o) => { if (!o) setDeleteServiceState(null); }}
        busy={busy}
        serviceName={deleteServiceState?.name ?? ""}
        canDelete={deleteServiceState?.canDelete ?? false}
        appointmentCount={deleteServiceState?.appointmentCount ?? 0}
        seriesCount={deleteServiceState?.seriesCount ?? 0}
        onConfirm={handleConfirmDeleteService}
      />

      <DeleteChecklistDialog
        open={deleteChecklistState !== null}
        onOpenChange={(o) => { if (!o) setDeleteChecklistState(null); }}
        busy={busy}
        checklistName={deleteChecklistState?.name ?? ""}
        itemCount={deleteChecklistState?.itemCount ?? 0}
        onConfirm={handleConfirmDeleteChecklist}
      />
    </>
  );
}
