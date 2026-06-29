"use client";

import { Search, SprayCan, Plus, RefreshCw, X, Eye, EyeOff, Mail } from "lucide-react";
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
import { CleanersTable } from "./CleanersTable";
import { CleanersCardList } from "./CleanersCardList";
import { CleanersBulkBar } from "./CleanersBulkBar";
import { InviteStatusBadge } from "./cleaners-presenters";
import { PeopleSegmentTabs } from "./PeopleSegmentTabs";
import { CLEANER_SORTS } from "./cleaners-types";
import type {
  CleanerRowAction,
  CleanerRowVM,
  CleanerSort,
  InviteRowAction,
  PendingInviteRowVM,
} from "./cleaners-types";
import type { PeopleSegment } from "./staff-types";

function CleanersSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-soft-sm"
        >
          <Skeleton className="size-9 rounded-pill" />
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="hidden h-7 w-20 sm:block" />
          <Skeleton className="hidden h-7 w-16 lg:block" />
        </div>
      ))}
    </div>
  );
}

function PendingInvitesGroup({
  invites,
  canEdit,
  busy,
  onInviteAction,
}: {
  invites: PendingInviteRowVM[];
  canEdit: boolean;
  busy?: boolean;
  onInviteAction: (inviteId: string, action: InviteRowAction) => void;
}) {
  if (invites.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        Pending invites ({invites.length})
      </h2>
      <div className="overflow-hidden rounded-card border border-dashed border-border bg-muted/20">
        {invites.map((inv) => (
          <div
            key={inv.inviteId}
            className="flex flex-col items-start gap-2 border-b border-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="flex min-w-0 max-w-full items-center gap-2.5">
              <Mail className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{inv.email}</div>
                <div className="text-xs text-muted-foreground">{inv.invitedLabel}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              <InviteStatusBadge status={inv.status} />
              {canEdit ? (
                <>
                  {inv.canResend ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onInviteAction(inv.inviteId, "resend")}
                    >
                      <RefreshCw /> Resend
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-critical-50 hover:text-destructive"
                    disabled={busy}
                    onClick={() => onInviteAction(inv.inviteId, "cancel")}
                  >
                    <X /> Cancel
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export type OperatorCleanersViewProps = {
  segment: PeopleSegment;
  onSegmentChange: (v: PeopleSegment) => void;
  showSegmentTabs: boolean;
  loading?: boolean;
  rows: CleanerRowVM[];
  pendingInvites: PendingInviteRowVM[];
  totalActiveCount: number;
  benchedCount: number;
  canViewPayments: boolean;
  canEdit: boolean;
  bulkBusy?: boolean;

  search: string;
  onSearchChange: (v: string) => void;
  sort: CleanerSort;
  onSortChange: (v: CleanerSort) => void;
  showBenched: boolean;
  onToggleBenched: () => void;

  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onClearSelection: () => void;

  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: CleanerRowAction) => void;
  onInviteAction: (inviteId: string, action: InviteRowAction) => void;
  onBulkDeactivate: () => void;
  onNewCleaner?: () => void;
};

export function OperatorCleanersView({
  segment,
  onSegmentChange,
  showSegmentTabs,
  loading,
  rows,
  pendingInvites,
  totalActiveCount,
  benchedCount,
  canViewPayments,
  canEdit,
  bulkBusy,
  search,
  onSearchChange,
  sort,
  onSortChange,
  showBenched,
  onToggleBenched,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onClearSelection,
  onOpenRow,
  onRowAction,
  onInviteAction,
  onBulkDeactivate,
  onNewCleaner,
}: OperatorCleanersViewProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const filtersActive = !!search;
  const showNew = canEdit && !!onNewCleaner;
  const pendingCount = pendingInvites.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Cleaners &amp; team</h1>
          {showNew ? (
            <Button onClick={onNewCleaner} className="shrink-0">
              <Plus /> Invite cleaner
            </Button>
          ) : null}
        </div>

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
                aria-label="Search cleaners"
              />
            </div>
          }
        >
          {showSegmentTabs ? <PeopleSegmentTabs value={segment} onChange={onSegmentChange} /> : null}
          <Select value={sort} onValueChange={(v) => onSortChange(v as CleanerSort)}>
            <SelectTrigger className="w-40" aria-label="Sort cleaners">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLEANER_SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {benchedCount > 0 || showBenched ? (
            <Button variant="secondary" onClick={onToggleBenched} aria-pressed={showBenched}>
              {showBenched ? <EyeOff /> : <Eye />}
              {showBenched ? "Hide benched" : `Show benched (${benchedCount})`}
            </Button>
          ) : null}
        </ListFilterBar>
      </div>

      {filtersActive && !loading && rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing {rows.length} of {totalActiveCount}
        </p>
      ) : null}

      <PendingInvitesGroup
        invites={pendingInvites}
        canEdit={canEdit}
        busy={bulkBusy}
        onInviteAction={onInviteAction}
      />

      {loading ? (
        <CleanersSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<SprayCan />}
          title={
            totalActiveCount === 0 && pendingCount === 0
              ? "No cleaners yet"
              : "No cleaners match your search"
          }
          description={
            totalActiveCount === 0 && pendingCount === 0
              ? "Invite your first cleaner to start building your crew."
              : "Try a different name, email, or phone number."
          }
          action={
            totalActiveCount === 0 && pendingCount === 0 && showNew ? (
              <Button onClick={onNewCleaner}>
                <Plus /> Invite cleaner
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
            <CleanersTable
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
            <CleanersCardList
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

      <CleanersBulkBar
        count={selectedIds.size}
        canManage={canEdit}
        busy={bulkBusy}
        onDeactivate={onBulkDeactivate}
        onClear={onClearSelection}
      />
    </div>
  );
}
