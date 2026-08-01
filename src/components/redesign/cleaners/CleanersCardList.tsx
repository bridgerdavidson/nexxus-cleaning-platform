"use client";

import { MoreHorizontal, Pencil, Trash2, Eye, Ban, RotateCcw, Mail, CalendarClock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CleanerStatusBadge, ConnectBadge, FailedPayoutBadge, OwedBadge } from "./cleaners-presenters";
import type { CleanerRowAction, CleanerRowVM } from "./cleaners-types";

export type CleanersCardListProps = {
  rows: CleanerRowVM[];
  canViewPayments: boolean;
  canEdit: boolean;
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: CleanerRowAction) => void;
};

export function CleanersCardList({
  rows,
  canViewPayments,
  canEdit,
  selectedIds,
  onToggleRow,
  onOpenRow,
  onRowAction,
}: CleanersCardListProps) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const selected = selectedIds.has(row.id);
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
            className="rounded-card border border-border bg-card p-4 shadow-soft-sm transition-colors duration-200 hover:border-brand-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=selected]:border-brand-600/60 data-[state=selected]:bg-brand-50/60"
            data-state={selected ? "selected" : undefined}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {canEdit ? (
                  <span className="flex" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => onToggleRow(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  </span>
                ) : null}
                <Avatar className="size-10">
                  {row.avatarUrl ? <AvatarImage src={row.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-xs">{row.initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-foreground">{row.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Mail className="size-3 shrink-0" />
                    <span className="truncate">{row.email}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton aria-label="Cleaner actions" className="h-9 w-9">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[12rem]">
                    <DropdownMenuItem onSelect={() => onRowAction(row.id, "open")}>
                      <Eye /> Open details
                    </DropdownMenuItem>
                    {canEdit ? (
                      <DropdownMenuItem onSelect={() => onRowAction(row.id, "edit")}>
                        <Pencil /> Edit
                      </DropdownMenuItem>
                    ) : null}
                    {canEdit ? (
                      <>
                        <DropdownMenuSeparator />
                        {row.status === "benched" ? (
                          <DropdownMenuItem onSelect={() => onRowAction(row.id, "reactivate")}>
                            <RotateCcw /> Reactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => onRowAction(row.id, "deactivate")}>
                            <Ban /> Deactivate
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem destructive onSelect={() => onRowAction(row.id, "remove")}>
                          <Trash2 /> Remove
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {row.status === "benched" || row.connect !== "ready" || row.payoutFailed || row.owedLabel ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <CleanerStatusBadge status={row.status} />
                <ConnectBadge state={row.connect} />
                {row.payoutFailed ? <FailedPayoutBadge /> : null}
                {row.owedLabel ? <OwedBadge label={row.owedLabel} /> : null}
              </div>
            ) : null}

            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarClock className="size-3.5 shrink-0" />
                {row.thisWeekLabel}
              </span>
              <span className="flex items-center gap-2">
                {canViewPayments ? (
                  <span className="font-semibold text-foreground">{row.earningsLabel ?? "$0"}</span>
                ) : null}
                <span className="text-xs text-muted-foreground">{row.payLabel}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
