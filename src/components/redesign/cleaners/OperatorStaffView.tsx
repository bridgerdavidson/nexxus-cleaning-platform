"use client";

import { Users, Plus, RefreshCw, X, Mail } from "lucide-react";
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
import { StaffTable } from "./StaffTable";
import { StaffCardList } from "./StaffCardList";
import { InviteStatusBadge } from "./cleaners-presenters";
import { PeopleToolbar } from "./PeopleToolbar";
import { STAFF_SORTS } from "./staff-types";
import type {
  PeopleSegment,
  StaffRowAction,
  StaffRowVM,
  StaffPendingInviteVM,
  StaffSort,
} from "./staff-types";
import type { InviteRowAction } from "./cleaners-types";

function StaffSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-soft-sm"
        >
          <Skeleton className="size-9 rounded-pill" />
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="hidden h-7 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}

function StaffPendingInvitesGroup({
  invites,
  canManage,
  busy,
  onInviteAction,
}: {
  invites: StaffPendingInviteVM[];
  canManage: boolean;
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
                <div className="text-xs text-muted-foreground">
                  {inv.roleLabel} · {inv.invitedLabel}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              <InviteStatusBadge status={inv.status} />
              {canManage ? (
                <>
                  {inv.canResend ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => onInviteAction(inv.inviteId, "resend")}>
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

export type OperatorStaffViewProps = {
  segment: PeopleSegment;
  onSegmentChange: (v: PeopleSegment) => void;
  showSegmentTabs: boolean;
  loading?: boolean;
  rows: StaffRowVM[];
  pendingInvites: StaffPendingInviteVM[];
  totalCount: number;
  canManage: boolean;
  busy?: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  sort: StaffSort;
  onSortChange: (v: StaffSort) => void;
  onOpenRow: (id: string) => void;
  onRowAction: (id: string, action: StaffRowAction) => void;
  onInviteAction: (inviteId: string, action: InviteRowAction) => void;
  onNewStaff?: () => void;
};

export function OperatorStaffView({
  segment,
  onSegmentChange,
  showSegmentTabs,
  loading,
  rows,
  pendingInvites,
  totalCount,
  canManage,
  busy,
  search,
  onSearchChange,
  sort,
  onSortChange,
  onOpenRow,
  onRowAction,
  onInviteAction,
  onNewStaff,
}: OperatorStaffViewProps) {
  const filtersActive = !!search;
  const showNew = canManage && !!onNewStaff;
  const pendingCount = pendingInvites.length;

  return (
    <div className="space-y-6">
      <PeopleToolbar
        title="Cleaners & team"
        createLabel="Invite staff"
        onCreate={onNewStaff}
        showCreate={showNew}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search by name or email"
        searchAriaLabel="Search staff"
        segment={segment}
        onSegmentChange={onSegmentChange}
        showSegmentTabs={showSegmentTabs}
        sort={
          <Select value={sort} onValueChange={(v) => onSortChange(v as StaffSort)}>
            <SelectTrigger className="w-full" aria-label="Sort staff">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAFF_SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {filtersActive && !loading && rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing {rows.length} of {totalCount}
        </p>
      ) : null}

      <StaffPendingInvitesGroup
        invites={pendingInvites}
        canManage={canManage}
        busy={busy}
        onInviteAction={onInviteAction}
      />

      {loading ? (
        <StaffSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={totalCount === 0 && pendingCount === 0 ? "No staff yet" : "No staff match your search"}
          description={
            totalCount === 0 && pendingCount === 0
              ? "Invite a manager or admin to help run the business."
              : "Try a different name or email."
          }
          action={
            totalCount === 0 && pendingCount === 0 && showNew ? (
              <Button onClick={onNewStaff}>
                <Plus /> Invite team member
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
            <StaffTable rows={rows} canManage={canManage} onOpenRow={onOpenRow} onRowAction={onRowAction} />
          </div>
          <div className="lg:hidden">
            <StaffCardList rows={rows} canManage={canManage} onOpenRow={onOpenRow} onRowAction={onRowAction} />
          </div>
        </>
      )}
    </div>
  );
}
