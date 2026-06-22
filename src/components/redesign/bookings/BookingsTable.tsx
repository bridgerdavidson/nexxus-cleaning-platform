"use client";

import { MoreHorizontal, UserPlus, CalendarX2, Trash2, Eye } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BookingStatusBadge, PaymentBadge } from "./bookings-presenters";
import type { BookingRowAction, BookingRowVM } from "./bookings-types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function CleanerCell({ row }: { row: BookingRowVM }) {
  if (!row.cleaner) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-7">
        {row.cleanerAvatarUrl ? <AvatarImage src={row.cleanerAvatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[11px]">{initials(row.cleaner)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm text-foreground">{row.cleaner}</span>
    </div>
  );
}

function RowMenu({
  row,
  canDelete,
  onAction,
}: {
  row: BookingRowVM;
  canDelete: boolean;
  onAction: (id: string, action: BookingRowAction) => void;
}) {
  const cancellable = row.status !== "cancelled" && row.status !== "completed";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Booking actions" className="h-9 w-9">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuItem onSelect={() => onAction(row.id, "open")}>
          <Eye /> Open details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction(row.id, "assign")}>
          <UserPlus /> {row.isUnassigned ? "Assign cleaner" : "Reassign cleaner"}
        </DropdownMenuItem>
        {cancellable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction(row.id, "cancel")}>
              <CalendarX2 /> Cancel booking
            </DropdownMenuItem>
          </>
        ) : null}
        {canDelete ? (
          <DropdownMenuItem destructive onSelect={() => onAction(row.id, "delete")}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type BookingsTableProps = {
  rows: BookingRowVM[];
  canViewPayments: boolean;
  canDelete: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  onToggleAll: () => void;
  onToggleRow: (id: string) => void;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: BookingRowAction) => void;
};

export function BookingsTable({
  rows,
  canViewPayments,
  canDelete,
  selectedIds,
  allSelected,
  onToggleAll,
  onToggleRow,
  onOpenRow,
  onRowAction,
}: BookingsTableProps) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => onToggleAll()}
                aria-label="Select all bookings"
              />
            </TableHead>
            <TableHead className="w-32">When</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Cleaner</TableHead>
            <TableHead>Status</TableHead>
            {canViewPayments ? <TableHead>Payment</TableHead> : null}
            <TableHead className="w-12 text-right" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const selected = selectedIds.has(row.id);
            return (
              <TableRow
                key={row.id}
                data-state={selected ? "selected" : undefined}
                onClick={() => onOpenRow(row.id)}
                className="cursor-pointer data-[state=selected]:bg-brand-50/60"
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => onToggleRow(row.id)}
                    aria-label={`Select booking on ${row.dateLabel}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-semibold text-foreground">{row.dateLabel}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.weekdayLabel} · {row.timeLabel}
                  </div>
                </TableCell>
                <TableCell className="max-w-[18rem]">
                  <div className="truncate font-semibold text-foreground">{row.customer}</div>
                  <div className="truncate text-xs text-muted-foreground">{row.property}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-foreground">{row.service}</div>
                  {row.durationLabel ? (
                    <div className="text-xs text-muted-foreground">{row.durationLabel}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <CleanerCell row={row} />
                </TableCell>
                <TableCell>
                  <BookingStatusBadge badge={row.badge} />
                </TableCell>
                {canViewPayments ? (
                  <TableCell>
                    <PaymentBadge payment={row.payment} />
                  </TableCell>
                ) : null}
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <RowMenu row={row} canDelete={canDelete} onAction={onRowAction} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
