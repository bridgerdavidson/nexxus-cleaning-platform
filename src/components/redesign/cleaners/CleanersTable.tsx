"use client";

import { MoreHorizontal, Pencil, Trash2, Eye, Ban, RotateCcw } from "lucide-react";
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
import { CleanerStatusBadge, ConnectBadge, FailedPayoutBadge, OwedBadge, PayNotSetBadge } from "./cleaners-presenters";
import type { CleanerRowAction, CleanerRowVM } from "./cleaners-types";

function RowMenu({
  row,
  canEdit,
  onAction,
}: {
  row: CleanerRowVM;
  canEdit: boolean;
  onAction: (id: string, action: CleanerRowAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Cleaner actions" className="h-9 w-9">
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
            {row.status === "benched" ? (
              <DropdownMenuItem onSelect={() => onAction(row.id, "reactivate")}>
                <RotateCcw /> Reactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onAction(row.id, "deactivate")}>
                <Ban /> Deactivate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem destructive onSelect={() => onAction(row.id, "remove")}>
              <Trash2 /> Remove
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type CleanersTableProps = {
  rows: CleanerRowVM[];
  canViewPayments: boolean;
  canEdit: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  onToggleAll: () => void;
  onToggleRow: (id: string) => void;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: CleanerRowAction) => void;
};

export function CleanersTable({
  rows,
  canViewPayments,
  canEdit,
  selectedIds,
  allSelected,
  onToggleAll,
  onToggleRow,
  onOpenRow,
  onRowAction,
}: CleanersTableProps) {
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
                  aria-label="Select all cleaners"
                />
              </TableHead>
            ) : null}
            <TableHead>Cleaner</TableHead>
            <TableHead className="text-right">This week</TableHead>
            {canViewPayments ? <TableHead className="text-right">Earnings</TableHead> : null}
            <TableHead className="text-right">Pay</TableHead>
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
                <TableCell className="max-w-[24rem]">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-9">
                      {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="text-xs">{row.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{row.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <CleanerStatusBadge status={row.status} />
                        <PayNotSetBadge configured={row.payConfigured} />
                        <ConnectBadge state={row.connect} />
                        {row.payoutFailed ? <FailedPayoutBadge /> : null}
                        {row.owedLabel ? <OwedBadge label={row.owedLabel} /> : null}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm text-foreground">{row.thisWeekLabel}</TableCell>
                {canViewPayments ? (
                  <TableCell className="text-right">
                    <span className="font-semibold tnum text-foreground">{row.earningsLabel ?? "$0"}</span>
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap text-right tnum text-muted-foreground">{row.payLabel}</TableCell>
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
