"use client";

import { MoreHorizontal, Eye, SlidersHorizontal, Trash2, Mail } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoleBadge } from "./staff-presenters";
import type { StaffRowAction, StaffRowVM } from "./staff-types";

export type StaffCardListProps = {
  rows: StaffRowVM[];
  canManage: boolean;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: StaffRowAction) => void;
};

export function StaffCardList({ rows, canManage, onOpenRow, onRowAction }: StaffCardListProps) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const canRemove = canManage && !row.isOwner && !row.isSelf;
        const canEditPerms = canManage && row.role === "manager";
        return (
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
                <Avatar className="size-10">
                  {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-xs">{row.initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{row.name}</span>
                    {row.isSelf ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="size-3 shrink-0" />
                    <span className="truncate">{row.email}</span>
                  </div>
                </div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton aria-label="Staff actions" className="h-9 w-9">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[12rem]">
                    <DropdownMenuItem onSelect={() => onRowAction(row.id, "open")}>
                      <Eye /> Open details
                    </DropdownMenuItem>
                    {canEditPerms ? (
                      <DropdownMenuItem onSelect={() => onRowAction(row.id, "permissions")}>
                        <SlidersHorizontal /> Manage permissions
                      </DropdownMenuItem>
                    ) : null}
                    {canRemove ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => onRowAction(row.id, "remove")}>
                          <Trash2 /> Remove
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <RoleBadge role={row.role} />
              <span className="text-xs text-muted-foreground">{row.accessLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
