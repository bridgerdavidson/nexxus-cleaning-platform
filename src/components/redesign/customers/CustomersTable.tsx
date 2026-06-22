"use client";

import { MoreHorizontal, Pencil, Trash2, Eye } from "lucide-react";
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
import type { CustomerRowAction, CustomerRowVM } from "./customers-types";

function RowMenu({
  row,
  canEdit,
  onAction,
}: {
  row: CustomerRowVM;
  canEdit: boolean;
  onAction: (id: string, action: CustomerRowAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Customer actions" className="h-9 w-9">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuItem onSelect={() => onAction(row.id, "open")}>
          <Eye /> Open details
        </DropdownMenuItem>
        {canEdit ? (
          <DropdownMenuItem onSelect={() => onAction(row.id, "edit")}>
            <Pencil /> Edit
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => onAction(row.id, "delete")}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type CustomersTableProps = {
  rows: CustomerRowVM[];
  canViewPayments: boolean;
  canEdit: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  onToggleAll: () => void;
  onToggleRow: (id: string) => void;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: CustomerRowAction) => void;
};

export function CustomersTable({
  rows,
  canViewPayments,
  canEdit,
  selectedIds,
  allSelected,
  onToggleAll,
  onToggleRow,
  onOpenRow,
  onRowAction,
}: CustomersTableProps) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {canEdit ? (
              <TableHead className="w-12">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={() => onToggleAll()}
                  aria-label="Select all customers"
                />
              </TableHead>
            ) : null}
            <TableHead>Customer</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead className="text-right">Properties</TableHead>
            <TableHead className="text-right">Bookings</TableHead>
            {canViewPayments ? <TableHead className="text-right">Total spent</TableHead> : null}
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
                {canEdit ? (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => onToggleRow(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="max-w-[20rem]">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-9">
                      {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="text-xs">{row.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{row.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {row.phone ? (
                    <span className="text-sm text-foreground">{row.phone}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">No phone</span>
                  )}
                </TableCell>
                <TableCell className="text-right tnum text-foreground">{row.propertiesCount}</TableCell>
                <TableCell className="text-right tnum text-foreground">{row.appointmentsCount}</TableCell>
                {canViewPayments ? (
                  <TableCell className="text-right">
                    <span className="font-semibold tnum text-foreground">{row.totalSpentLabel ?? "$0"}</span>
                  </TableCell>
                ) : null}
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <RowMenu row={row} canEdit={canEdit} onAction={onRowAction} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
