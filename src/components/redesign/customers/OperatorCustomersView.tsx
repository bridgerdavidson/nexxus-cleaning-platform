"use client";

import { Search, Users, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListFilterBar } from "@/components/redesign/shared/ListFilterBar";
import { CustomersTable } from "./CustomersTable";
import { CustomersCardList } from "./CustomersCardList";
import { CustomersBulkBar } from "./CustomersBulkBar";
import { CUSTOMER_SORTS } from "./customers-types";
import type { CustomerRowAction, CustomerRowVM, CustomerSort } from "./customers-types";

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
  // Don't expose spend ordering to a viewer who can't see payment amounts.
  const sortOptions = canViewPayments ? CUSTOMER_SORTS : CUSTOMER_SORTS.filter((s) => s.id !== "spent");
  // A lightweight live count for orientation (replaces the old KPI tiles).
  const countLabel = loading
    ? "Loading customers..."
    : totalCount === 0
      ? "No customers yet"
      : filtersActive
        ? `Showing ${rows.length} of ${totalCount}`
        : `${totalCount} ${totalCount === 1 ? "customer" : "customers"}`;

  return (
    <div className="max-w-[1700px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">{countLabel}</p>
        </div>
        {showNew ? (
          <Button onClick={onNewCustomer} className="shrink-0">
            <Plus /> New customer
          </Button>
        ) : null}
      </header>

      <ListFilterBar
        search={
          <div className="relative w-full">
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
        }
      >
        <Select value={sort} onValueChange={(v) => onSortChange(v as CustomerSort)}>
          <SelectTrigger className="w-44" aria-label="Sort customers">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ListFilterBar>

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
