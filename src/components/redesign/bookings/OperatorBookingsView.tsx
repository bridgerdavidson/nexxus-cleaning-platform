"use client";

import { Search, CalendarRange, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookingsTable } from "./BookingsTable";
import { BookingsCardList } from "./BookingsCardList";
import { BookingsBulkBar } from "./BookingsBulkBar";
import { ErrorState } from "@/components/ui/error-state";
import { BOOKING_SEGMENTS } from "./bookings-types";
import type {
  BookingRowAction,
  BookingRowVM,
  BookingSegment,
  CleanerOption,
  StatusFilter,
} from "./bookings-types";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function BookingsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-soft-sm"
        >
          <Skeleton className="size-6 rounded-chip" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="hidden h-7 w-24 sm:block" />
          <Skeleton className="hidden h-7 w-20 lg:block" />
        </div>
      ))}
    </div>
  );
}

export type OperatorBookingsViewProps = {
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  rows: BookingRowVM[];
  counts: Record<BookingSegment, number>;
  totalCount: number;
  canViewPayments: boolean;
  canEdit: boolean;
  canHandleRequests: boolean;
  canDelete: boolean;
  bulkBusy?: boolean;

  segment: BookingSegment;
  onSegmentChange: (s: BookingSegment) => void;
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  cleanerFilter: string;
  onCleanerFilterChange: (v: string) => void;
  cleanerOptions: CleanerOption[];

  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onClearSelection: () => void;

  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: BookingRowAction) => void;
  onBulkCancel: () => void;
  onBulkDelete: () => void;
  onNewBooking?: () => void;
};

export function OperatorBookingsView({
  loading,
  error,
  onRetry,
  rows,
  counts,
  totalCount,
  canViewPayments,
  canEdit,
  canHandleRequests,
  canDelete,
  bulkBusy,
  segment,
  onSegmentChange,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  cleanerFilter,
  onCleanerFilterChange,
  cleanerOptions,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onClearSelection,
  onOpenRow,
  onRowAction,
  onBulkCancel,
  onBulkDelete,
  onNewBooking,
}: OperatorBookingsViewProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const filtersActive = !!search || statusFilter !== "all" || cleanerFilter !== "all";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search, filter, and manage every appointment.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <Tabs value={segment} onValueChange={(v) => onSegmentChange(v as BookingSegment)}>
          <TabsList className="max-w-full justify-start gap-1 overflow-x-auto">
            {BOOKING_SEGMENTS.map((s) => (
              <TabsTrigger key={s.id} value={s.id} className="gap-1.5">
                {s.label}
                <span className="rounded-pill bg-foreground/10 px-1.5 text-xs font-semibold">
                  {counts[s.id]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search customer, property, cleaner, service"
              className="pl-10"
              aria-label="Search bookings"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
            <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={cleanerFilter} onValueChange={onCleanerFilterChange}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Filter by cleaner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cleaners</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {cleanerOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {error ? (
        <ErrorState title="Couldn't load bookings" onRetry={onRetry} />
      ) : loading ? (
        <BookingsSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarRange />}
          title={
            totalCount === 0
              ? "No bookings yet"
              : filtersActive
                ? "No bookings match your filters"
                : "Nothing in this view"
          }
          description={
            totalCount === 0
              ? "When appointments are booked they will show up here."
              : filtersActive
                ? "Try clearing the search or filters to widen the results."
                : "Switch to another tab to see more bookings."
          }
          action={
            totalCount === 0 && onNewBooking ? (
              <Button onClick={onNewBooking}>
                <Plus /> New booking
              </Button>
            ) : filtersActive ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onSearchChange("");
                  onStatusFilterChange("all");
                  onCleanerFilterChange("all");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <BookingsTable
              rows={rows}
              canViewPayments={canViewPayments}
              canEdit={canEdit}
              canHandleRequests={canHandleRequests}
              canDelete={canDelete}
              selectedIds={selectedIds}
              allSelected={allSelected}
              onToggleAll={onToggleAll}
              onToggleRow={onToggleRow}
              onOpenRow={onOpenRow}
              onRowAction={onRowAction}
            />
          </div>
          <div className="lg:hidden">
            <BookingsCardList
              rows={rows}
              canViewPayments={canViewPayments}
              canEdit={canEdit}
              canHandleRequests={canHandleRequests}
              canDelete={canDelete}
              selectedIds={selectedIds}
              onToggleRow={onToggleRow}
              onOpenRow={onOpenRow}
              onRowAction={onRowAction}
            />
          </div>
        </>
      )}

      <BookingsBulkBar
        count={selectedIds.size}
        canEdit={canEdit}
        canDelete={canDelete}
        busy={bulkBusy}
        onCancel={onBulkCancel}
        onDelete={onBulkDelete}
        onClear={onClearSelection}
      />
    </div>
  );
}
