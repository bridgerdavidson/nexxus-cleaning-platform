"use client";

import { MoreHorizontal, Pencil, Trash2, Eye, Mail, Phone, Home, CalendarDays } from "lucide-react";
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
import type { CustomerRowAction, CustomerRowVM } from "./customers-types";

export type CustomersCardListProps = {
  rows: CustomerRowVM[];
  canViewPayments: boolean;
  canEdit: boolean;
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: CustomerRowAction) => void;
};

export function CustomersCardList({
  rows,
  canViewPayments,
  canEdit,
  selectedIds,
  onToggleRow,
  onOpenRow,
  onRowAction,
}: CustomersCardListProps) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const selected = selectedIds.has(row.id);
        const showFooter = (canViewPayments && !!row.totalSpentLabel) || !!row.lastServiceLabel;
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
                    <IconButton aria-label="Customer actions" className="h-9 w-9">
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
                        <DropdownMenuItem destructive onSelect={() => onRowAction(row.id, "delete")}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {row.phone ? (
                <div className="flex items-center gap-1.5">
                  <Phone className="size-3.5 shrink-0" />
                  <span className="truncate">{row.phone}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5">
                  <Home className="size-3.5 shrink-0" />
                  {row.propertiesCount} {row.propertiesCount === 1 ? "property" : "properties"}
                </span>
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="size-3.5 shrink-0" />
                  {row.appointmentsCount} {row.appointmentsCount === 1 ? "booking" : "bookings"}
                </span>
              </div>
            </div>

            {showFooter ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                {canViewPayments && row.totalSpentLabel ? (
                  <span className="text-sm font-semibold text-foreground">
                    {row.totalSpentLabel}
                    <span className="ml-1 font-normal text-muted-foreground">total</span>
                  </span>
                ) : (
                  <span />
                )}
                {row.lastServiceLabel ? (
                  <span className="text-xs text-muted-foreground">{row.lastServiceLabel}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
