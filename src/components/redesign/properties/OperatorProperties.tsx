"use client";

import { useMemo, useState } from "react";
import { Building2, CalendarPlus, MapPinHouse, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListFilterBar } from "@/components/redesign/shared/ListFilterBar";
import { useAdminProperties, type AdminProperty } from "@/hooks/useAdminData";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { useOpenOperatorBooking } from "@/components/redesign/bookings/new-booking/useOpenOperatorBooking";
import { buildPropertySeed } from "@/components/redesign/bookings/new-booking/seedFromProperty";
import { useOpenProperty } from "./useOpenProperty";
import { toPropertyRowVM, type PropertyRowVM } from "./propertyRowVM";
import { PropertyDeleteDialog } from "./PropertyDeleteDialog";

type OwnerFilter = "all" | "homeowner" | "org";

const OWNER_FILTERS: { id: OwnerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "homeowner", label: "Homeowner" },
  { id: "org", label: "Org-owned" },
];

function matchesSearch(row: PropertyRowVM, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return row.name.toLowerCase().includes(q) || row.addressLine.toLowerCase().includes(q);
}

function matchesOwnerFilter(row: PropertyRowVM, filter: OwnerFilter): boolean {
  if (filter === "all") return true;
  if (filter === "homeowner") return !row.isOrgOwned;
  return row.isOrgOwned;
}

function PropertyThumbnail({ photoUrl }: { photoUrl: string | null }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={photoUrl} alt="" className="size-11 shrink-0 rounded-control object-cover" />
    );
  }
  return (
    <div className="grid size-11 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-ink">
      <Building2 className="size-5" aria-hidden />
    </div>
  );
}

function OwnerCell({ row }: { row: PropertyRowVM }) {
  if (row.isOrgOwned) return <Badge variant="secondary">Org-owned</Badge>;
  return <span className="text-sm text-foreground">{row.ownerLabel}</span>;
}

function PropertiesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-soft-sm"
        >
          <Skeleton className="size-11 rounded-control" />
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="hidden h-7 w-24 sm:block" />
          <Skeleton className="hidden h-7 w-16 lg:block" />
        </div>
      ))}
    </div>
  );
}

function RowMenu({
  row,
  canEdit,
  canBook,
  onEdit,
  onDelete,
  onBook,
}: {
  row: PropertyRowVM;
  canEdit: boolean;
  canBook: boolean;
  onEdit: (id: string) => void;
  onDelete: (row: PropertyRowVM) => void;
  onBook: (row: PropertyRowVM) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Property actions" className="h-9 w-9">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {canBook ? (
          <DropdownMenuItem onSelect={() => onBook(row)}>
            <CalendarPlus /> Book
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <>
            <DropdownMenuItem onSelect={() => onEdit(row.id)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => onDelete(row)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PropertiesTable({
  rows,
  canEdit,
  canBook,
  onOpenRow,
  onEditRow,
  onDeleteRow,
  onBookRow,
}: {
  rows: PropertyRowVM[];
  canEdit: boolean;
  canBook: boolean;
  onOpenRow: (id: string) => void;
  onEditRow: (id: string) => void;
  onDeleteRow: (row: PropertyRowVM) => void;
  onBookRow: (row: PropertyRowVM) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Property</TableHead>
            <TableHead>Homeowner</TableHead>
            <TableHead>Details</TableHead>
            <TableHead className="w-12 text-right" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} onClick={() => onOpenRow(row.id)} className="cursor-pointer">
              <TableCell className="max-w-[24rem]">
                <div className="flex items-center gap-3">
                  <PropertyThumbnail photoUrl={row.photoUrl} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{row.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.addressLine}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <OwnerCell row={row} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.detailsLabel}</TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {canEdit || canBook ? (
                  <RowMenu
                    row={row}
                    canEdit={canEdit}
                    canBook={canBook}
                    onEdit={onEditRow}
                    onDelete={onDeleteRow}
                    onBook={onBookRow}
                  />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PropertiesCardList({
  rows,
  canEdit,
  canBook,
  onOpenRow,
  onEditRow,
  onDeleteRow,
  onBookRow,
}: {
  rows: PropertyRowVM[];
  canEdit: boolean;
  canBook: boolean;
  onOpenRow: (id: string) => void;
  onEditRow: (id: string) => void;
  onDeleteRow: (row: PropertyRowVM) => void;
  onBookRow: (row: PropertyRowVM) => void;
}) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={row.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpenRow(row.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenRow(row.id);
            }
          }}
          className="rounded-card border border-border bg-card p-4 shadow-soft-sm transition-colors duration-200 hover:border-brand-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <PropertyThumbnail photoUrl={row.photoUrl} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-foreground">{row.name}</div>
                <div className="truncate text-xs text-muted-foreground">{row.addressLine}</div>
              </div>
            </div>
            {canEdit || canBook ? (
              <span onClick={(e) => e.stopPropagation()}>
                <RowMenu
                  row={row}
                  canEdit={canEdit}
                  canBook={canBook}
                  onEdit={onEditRow}
                  onDelete={onDeleteRow}
                  onBook={onBookRow}
                />
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <OwnerCell row={row} />
            <span>{row.detailsLabel}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Operator Properties workspace: list + filters over `useAdminProperties()`,
 * with the row-open / edit / add wiring routed through the shell-level
 * `?property=` host (useOpenProperty). Mirrors the OperatorCustomers idiom
 * (ListFilterBar + table/card responsive split + Skeleton/ErrorState/
 * EmptyState), kept in one file since the list has no lazy-loaded detail
 * data of its own (the sheet is a global host, not owned by this screen).
 * Delete opens `PropertyDeleteDialog` from the row menu (single instance
 * driven by `deleteTarget`); the dialog's own invalidation drops the row out
 * of the list once it archives/deletes. The row menu's "Book" item is gated
 * on booking permission (not property permission, mirroring OperatorShell's
 * canCreateBooking gate) and seeds the operator new-booking sheet from the
 * row's underlying `AdminProperty` via `buildPropertySeed`.
 */
export function OperatorProperties() {
  const { currentOrgRole, currentOrganizationId } = useAuth();
  const { permissions } = useManagerPermissions();
  const { properties, loading, error, refetch } = useAdminProperties();
  const { open, openForEdit } = useOpenProperty();
  const openBooking = useOpenOperatorBooking();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canEdit = privileged || !!permissions?.can_edit_properties;
  const canBook = privileged || !!permissions?.can_edit_bookings;

  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const rows = useMemo(() => properties.map(toPropertyRowVM), [properties]);
  const filteredRows = useMemo(
    () => rows.filter((r) => matchesSearch(r, search) && matchesOwnerFilter(r, ownerFilter)),
    [rows, search, ownerFilter],
  );
  // The row VM doesn't carry owner_id, so the "Book" action looks the raw
  // AdminProperty back up by id to build the seed.
  const propertyById = useMemo(
    () => new Map<string, AdminProperty>(properties.map((p) => [p.id, p])),
    [properties],
  );
  const handleBookRow = (row: PropertyRowVM) => {
    const property = propertyById.get(row.id);
    if (property) openBooking(buildPropertySeed(property));
  };

  const filtersActive = !!search || ownerFilter !== "all";
  const countLabel = loading
    ? "Loading properties..."
    : rows.length === 0
      ? "No properties yet"
      : filtersActive
        ? `Showing ${filteredRows.length} of ${rows.length}`
        : `${rows.length} ${rows.length === 1 ? "property" : "properties"}`;

  return (
    <div className="max-w-[1700px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Properties</h1>
          <p className="mt-1 text-sm text-muted-foreground">{countLabel}</p>
        </div>
        {canEdit ? (
          <Button onClick={() => open("new")} className="shrink-0">
            <Plus /> Add property
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or address"
              className="pl-10"
              aria-label="Search properties"
            />
          </div>
        }
      >
        <Select value={ownerFilter} onValueChange={(v) => setOwnerFilter(v as OwnerFilter)}>
          <SelectTrigger className="w-44" aria-label="Filter by owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OWNER_FILTERS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ListFilterBar>

      {error ? (
        <ErrorState title="Couldn't load properties" onRetry={() => refetch()} />
      ) : loading ? (
        <PropertiesSkeleton />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon={<MapPinHouse />}
          title={rows.length === 0 ? "No properties yet." : "No properties match your filters"}
          description={
            rows.length === 0
              ? "Add your first property to get started."
              : "Try a different name or address, or clear the filters."
          }
          action={
            rows.length === 0 && canEdit ? (
              <Button onClick={() => open("new")}>
                <Plus /> Add property
              </Button>
            ) : filtersActive ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setOwnerFilter("all");
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
            <PropertiesTable
              rows={filteredRows}
              canEdit={canEdit}
              canBook={canBook}
              onOpenRow={open}
              onEditRow={openForEdit}
              onDeleteRow={(row) => setDeleteTarget({ id: row.id, name: row.name })}
              onBookRow={handleBookRow}
            />
          </div>
          <div className="lg:hidden">
            <PropertiesCardList
              rows={filteredRows}
              canEdit={canEdit}
              canBook={canBook}
              onOpenRow={open}
              onEditRow={openForEdit}
              onDeleteRow={(row) => setDeleteTarget({ id: row.id, name: row.name })}
              onBookRow={handleBookRow}
            />
          </div>
        </>
      )}

      <PropertyDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        propertyId={deleteTarget?.id ?? ""}
        propertyName={deleteTarget?.name ?? ""}
        organizationId={currentOrganizationId ?? ""}
        onDeleted={() => setDeleteTarget(null)}
      />
    </div>
  );
}
