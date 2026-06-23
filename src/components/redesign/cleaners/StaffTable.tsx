"use client";

import { MoreHorizontal, Eye, SlidersHorizontal, Trash2 } from "lucide-react";
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
import { RoleBadge } from "./staff-presenters";
import type { StaffRowAction, StaffRowVM } from "./staff-types";

function RowMenu({
  row,
  canManage,
  onAction,
}: {
  row: StaffRowVM;
  canManage: boolean;
  onAction: (id: string, action: StaffRowAction) => void;
}) {
  const canRemove = canManage && !row.isOwner && !row.isSelf;
  const canEditPerms = canManage && row.role === "manager";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="Staff actions" className="h-9 w-9">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuItem onSelect={() => onAction(row.id, "open")}>
          <Eye /> Open details
        </DropdownMenuItem>
        {canEditPerms ? (
          <DropdownMenuItem onSelect={() => onAction(row.id, "permissions")}>
            <SlidersHorizontal /> Manage permissions
          </DropdownMenuItem>
        ) : null}
        {canRemove ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => onAction(row.id, "remove")}>
              <Trash2 /> Remove
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type StaffTableProps = {
  rows: StaffRowVM[];
  canManage: boolean;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: StaffRowAction) => void;
};

export function StaffTable({ rows, canManage, onOpenRow, onRowAction }: StaffTableProps) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Member</TableHead>
            <TableHead>Access</TableHead>
            <TableHead>Since</TableHead>
            <TableHead className="w-12 text-right" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              onClick={() => onOpenRow(row.id)}
              className="cursor-pointer"
            >
              <TableCell className="max-w-[24rem]">
                <div className="flex items-center gap-3">
                  <Avatar className="size-9">
                    {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="text-xs">{row.initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-foreground">{row.name}</span>
                      {row.isSelf ? (
                        <span className="text-xs text-muted-foreground">(you)</span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                    <div className="mt-1">
                      <RoleBadge role={row.role} />
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-sm text-foreground">{row.accessLabel}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.sinceLabel}</TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <RowMenu row={row} canManage={canManage} onAction={onRowAction} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
