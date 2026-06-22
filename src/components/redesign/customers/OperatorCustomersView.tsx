"use client";

import { Search, Users, DollarSign, CalendarDays, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomersTable } from "./CustomersTable";
import { CustomersCardList } from "./CustomersCardList";
import { CustomersBulkBar } from "./CustomersBulkBar";
import { CUSTOMER_SORTS } from "./customers-types";
import type { CustomerRowAction, CustomerRowVM, CustomerSort } from "./customers-types";

export type CustomerStats = {
  totalCustomers: number;
  /** null when the viewer cannot see payments (the Revenue tile is dropped). */
  totalRevenueLabel: string | null;
  totalAppointments: number;
};

function CustomersSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-soft-sm"
        >
          <Skeleton className="size-9 rounded-pill" />
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="hidden h-7 w-24 sm:block" />
          <Skeleton className="hidden h-7 w-16 lg:block" />
        </div>
      ))}
    </div>
  );
}

export type OperatorCustomersViewProps = {
  loading?: boolean;
  rows: CustomerRowVM[];
  stats: CustomerStats;
  totalCount: number;
  canViewPayments: boolean;
  canEdit: boolean;
  bulkBusy?: boolean;

  search: string;
  onSearchChange: (v: string) => void;
  sort: CustomerSort;
  onSortChange: (v: CustomerSort) => void;

  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onClearSelection: () => void;

  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: CustomerRowAction) => void;
  onBulkDelete: () => void;
  onNewCustomer?: () => void;
};

export function OperatorCustomersView({
  loading,
  rows,
  stats,
  totalCount,
  canViewPayments,
  canEdit,
  bulkBusy,
  search,
  onSearchChange,
  sort,
  onSortChange,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onClearSelection,
  onOpenRow,
  onRowAction,
  onBulkDelete,
  onNewCustomer,
}: OperatorCustomersViewProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const filtersActive = !!search;
  const showNew = canEdit && !!onNewCustomer;
  const tileCols = canViewPayments ? "sm:grid-cols-3" : "sm:grid-cols-2";

  return (
    <div className="max-w-[1700px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View profiles, properties, and booking history.
          </p>
        </div>
        {showNew ? (
          <Button onClick={onNewCustomer} className="sm:shrink-0">
            <Plus /> New customer
          </Button>
        ) : null}
      </header>

      <div className={`grid grid-cols-2 gap-4 ${tileCols}`}>
        <StatTile label="Customers" value={String(stats.totalCustomers)} icon={<Users />} />
        {canViewPayments && stats.totalRevenueLabel ? (
          <StatTile label="Revenue" value={stats.totalRevenueLabel} icon={<DollarSign />} />
        ) : null}
        <StatTile label="Bookings" value={String(stats.totalAppointments)} icon={<CalendarDays />} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="pl-10"
            aria-label="Search customers"
          />
        </div>
        <Select value={sort} onValueChange={(v) => onSortChange(v as CustomerSort)}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Sort customers">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMER_SORTS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <CustomersSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={totalCount === 0 ? "No customers yet" : "No customers match your search"}
          description={
            totalCount === 0
              ? "Invite your first customer to get started."
              : "Try a different name, email, or phone number."
          }
          action={
            totalCount === 0 && showNew ? (
              <Button onClick={onNewCustomer}>
                <Plus /> New customer
              </Button>
            ) : filtersActive ? (
              <Button variant="secondary" onClick={() => onSearchChange("")}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden lg:block">
            <CustomersTable
              rows={rows}
              canViewPayments={canViewPayments}
              canEdit={canEdit}
              selectedIds={selectedIds}
              allSelected={allSelected}
              onToggleAll={onToggleAll}
              onToggleRow={onToggleRow}
              onOpenRow={onOpenRow}
              onRowAction={onRowAction}
            />
          </div>
          <div className="lg:hidden">
            <CustomersCardList
              rows={rows}
              canViewPayments={canViewPayments}
              canEdit={canEdit}
              selectedIds={selectedIds}
              onToggleRow={onToggleRow}
              onOpenRow={onOpenRow}
              onRowAction={onRowAction}
            />
          </div>
        </>
      )}

      <CustomersBulkBar
        count={selectedIds.size}
        canDelete={canEdit}
        busy={bulkBusy}
        onDelete={onBulkDelete}
        onClear={onClearSelection}
      />
    </div>
  );
}
