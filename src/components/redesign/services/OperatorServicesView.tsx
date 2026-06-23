"use client";

import { Search, Plus, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ServicesList } from "./ServicesList";
import { ServiceDetailPane, type ServiceDetailHandlers } from "./ServiceDetailPane";
import { SERVICE_SORTS, SERVICE_STATUS_FILTERS } from "./services-types";
import type {
  ServiceRowVM, ServiceDetailVM, ChecklistVM, ServiceSort, ServiceStatusFilter,
} from "./services-types";

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-field px-3 py-2.5">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export type OperatorServicesViewProps = {
  loading?: boolean;
  rows: ServiceRowVM[];
  totalCount: number;
  activeCount: number;
  canManage: boolean;

  search: string;
  onSearchChange: (v: string) => void;
  sort: ServiceSort;
  onSortChange: (v: ServiceSort) => void;
  status: ServiceStatusFilter;
  onStatusChange: (v: ServiceStatusFilter) => void;

  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewService: () => void;

  detail: ServiceDetailVM | null;
  checklists: ChecklistVM[];
  checklistsLoading: boolean;
  detailHandlers: ServiceDetailHandlers;
};

export function OperatorServicesView({
  loading,
  rows,
  totalCount,
  activeCount,
  canManage,
  search,
  onSearchChange,
  sort,
  onSortChange,
  status,
  onStatusChange,
  selectedId,
  onSelect,
  onNewService,
  detail,
  checklists,
  checklistsLoading,
  detailHandlers,
}: OperatorServicesViewProps) {
  const filtersActive = !!search || status !== "active";
  const countLabel = loading
    ? "Loading services..."
    : totalCount === 0
      ? "No services yet"
      : filtersActive
        ? `Showing ${rows.length} of ${totalCount}`
        : `${totalCount} ${totalCount === 1 ? "service" : "services"} · ${activeCount} active`;

  return (
    <div className="max-w-[1700px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Services</h1>
          <p className="mt-1 text-sm text-muted-foreground">{countLabel}</p>
        </div>
        {canManage ? (
          <Button onClick={onNewService} className="sm:shrink-0">
            <Plus /> New service
          </Button>
        ) : null}
      </header>

      {totalCount === 0 && !loading ? (
        <EmptyState
          icon={<Tag />}
          title="No services yet"
          description="Create your first service to start taking bookings."
          action={canManage ? <Button onClick={onNewService}><Plus /> New service</Button> : undefined}
        />
      ) : (
        <>
          {/* Toolbar applies to the list; hidden on mobile when a service detail is open. */}
          <div className={cn("flex-col gap-3 sm:flex-row sm:items-center", selectedId ? "hidden lg:flex" : "flex")}>
            <div className="relative w-full sm:flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search services"
                className="pl-10"
                aria-label="Search services"
              />
            </div>
            <Select value={sort} onValueChange={(v: string) => onSortChange(v as ServiceSort)}>
              <SelectTrigger className="w-full sm:w-48 sm:shrink-0" aria-label="Sort services">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_SORTS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v: string) => onStatusChange(v as ServiceStatusFilter)}>
              <SelectTrigger className="w-full sm:w-36 sm:shrink-0" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
            <aside className={cn("min-w-0", selectedId && "hidden lg:block")}>
              {loading ? (
                <ListSkeleton />
              ) : rows.length === 0 ? (
                <div className="rounded-card border border-dashed border-border bg-card/50 px-4 py-10 text-center">
                  <p className="text-sm text-muted-foreground">No services match your search.</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => { onSearchChange(""); onStatusChange("active"); }}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <ServicesList rows={rows} selectedId={selectedId} onSelect={onSelect} />
              )}
            </aside>
            <section className={cn("min-w-0", !selectedId && "hidden lg:block")}>
              <ServiceDetailPane
                detail={detail}
                checklists={checklists}
                checklistsLoading={checklistsLoading}
                canManage={canManage}
                {...detailHandlers}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
