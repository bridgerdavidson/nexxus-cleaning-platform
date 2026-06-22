"use client";

import { MoreHorizontal, UserPlus, CalendarX2, Trash2, Eye, MapPin, User } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BookingStatusPill, PaymentBadge } from "./bookings-presenters";
import type { BookingRowAction, BookingRowVM } from "./bookings-types";

export type BookingsCardListProps = {
  rows: BookingRowVM[];
  canViewPayments: boolean;
  canDelete: boolean;
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: BookingRowAction) => void;
};

export function BookingsCardList({
  rows,
  canViewPayments,
  canDelete,
  selectedIds,
  onToggleRow,
  onOpenRow,
  onRowAction,
}: BookingsCardListProps) {
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const selected = selectedIds.has(row.id);
        const cancellable = row.status !== "cancelled" && row.status !== "completed";
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
              <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => onToggleRow(row.id)}
                  aria-label={`Select booking on ${row.dateLabel}`}
                />
                <div>
                  <div className="font-semibold text-foreground">
                    {row.dateLabel}
                    <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                      {row.timeLabel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <BookingStatusPill status={row.status} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton aria-label="Booking actions" className="h-9 w-9">
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[12rem]">
                    <DropdownMenuItem onSelect={() => onRowAction(row.id, "open")}>
                      <Eye /> Open details
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onRowAction(row.id, "assign")}>
                      <UserPlus /> {row.isUnassigned ? "Assign cleaner" : "Reassign cleaner"}
                    </DropdownMenuItem>
                    {cancellable ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onRowAction(row.id, "cancel")}>
                          <CalendarX2 /> Cancel booking
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {canDelete ? (
                      <DropdownMenuItem destructive onSelect={() => onRowAction(row.id, "delete")}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <div className="font-semibold text-foreground">{row.customer}</div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{row.property}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="size-3.5 shrink-0" />
                <span className="truncate">
                  {row.service}
                  {row.durationLabel ? ` · ${row.durationLabel}` : ""} ·{" "}
                  {row.cleaner ?? "Unassigned"}
                </span>
              </div>
            </div>

            {(row.attention || (canViewPayments && row.payment)) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {row.attention ? (
                  <span className="text-xs font-medium text-caution-700">{row.attention}</span>
                ) : null}
                {canViewPayments ? <PaymentBadge payment={row.payment} /> : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
