"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useOrgQuery } from "@/lib/useOrgQuery";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";
import { useInvites } from "@/hooks/useInvites";
import { useDetailParam } from "@/hooks/useDetailParam";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useAdminCleanerScorecards,
  useCleanerWorkload,
  updateCleaner,
  deleteCleanerById,
  cancelInvite,
  inviteTeamMember,
  type AdminCleanerScorecard,
  type CleanerUpcomingJob,
} from "@/hooks/useAdminData";
import type { Invite } from "@/types";
import { OperatorCleanersView } from "./OperatorCleanersView";
import { CleanerDetailSheet, type CleanerSaveFields } from "./CleanerDetailSheet";
import { AddCleanerDialog } from "./AddCleanerDialog";
import { deriveCleaners, payLabelOf } from "./deriveCleaners";
import type {
  CleanerDetailVM,
  CleanerRowAction,
  CleanerRowVM,
  CleanerSort,
  CleanerUpcomingVM,
  ConnectState,
  InviteRowAction,
  PendingInviteRowVM,
  PendingInviteStatus,
} from "./cleaners-types";
import type { PeopleSegment } from "./staff-types";

// --- formatting + derivation helpers (AdminCleanerScorecard -> view-model) ---

function money0(n: number): string {
  return `$${Math.round(n || 0).toLocaleString("en-US")}`;
}
function money2(n: number): string {
  return `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function monthDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function formatTime(t: string): string {
  const [hStr, mStr] = (t || "").split(":");
  let h = parseInt(hStr ?? "0", 10);
  if (Number.isNaN(h)) return t;
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}
function nameOf(c: AdminCleanerScorecard): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return n || c.email;
}
function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return (email[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
function connectStateOf(c: AdminCleanerScorecard): ConnectState {
  if (c.stripe_connect_onboarding_complete) return "ready";
  if (c.stripe_connect_account_id) return "incomplete";
  return "none";
}
function completionRateLabel(completed: number, cancelled: number): string {
  const total = completed + cancelled;
  if (total === 0) return "N/A";
  return `${Math.round((completed / total) * 100)}%`;
}
function thisWeekLabel(n: number): string {
  return n === 0 ? "No jobs this week" : `${n} this week`;
}
function toRowVM(c: AdminCleanerScorecard, canViewPayments: boolean): CleanerRowVM {
  const name = nameOf(c);
  const hasName = name !== c.email;
  return {
    id: c.id,
    name,
    email: c.email,
    phone: c.phone,
    avatarUrl: c.avatar_url,
    initials: initials(hasName ? name : "", c.email),
    status: c.deactivated_at ? "benched" : "active",
    connect: connectStateOf(c),
    owedLabel: canViewPayments && c.owed_now > 0 ? money0(c.owed_now) : null,
    payoutFailed: c.payouts_failed_count > 0,
    thisWeekLabel: thisWeekLabel(c.upcoming_this_week),
    upcomingCount: c.upcoming_jobs,
    earningsLabel: canViewPayments ? money0(c.cleaner_earnings) : null,
    payLabel: payLabelOf(c),
    payConfigured: c.payout_configured_at != null,
  };
}

function toDetailVM(c: AdminCleanerScorecard, canViewPayments: boolean): CleanerDetailVM {
  const name = nameOf(c);
  const hasName = name !== c.email;
  const connect = connectStateOf(c);
  return {
    id: c.id,
    name,
    email: c.email,
    phone: c.phone,
    avatarUrl: c.avatar_url,
    initials: initials(hasName ? name : "", c.email),
    status: c.deactivated_at ? "benched" : "active",
    connect,
    isAvailable: c.is_available,
    backgroundCheckVerified: c.background_check_verified,
    insuranceVerified: c.insurance_verified,
    firstName: c.first_name ?? "",
    lastName: c.last_name ?? "",
    payoutPercent: c.payout_percent,
    payoutModel: c.payout_model === "percentage_contractor" ? "percentage" : c.payout_model,
    flatRateCents: c.flat_rate_cents,
    payConfigured: c.payout_configured_at != null,
    hourlyRate: c.hourly_rate,
    experienceYears: c.experience_years,
    scorecard: {
      completedJobs: c.completed_jobs,
      completionRateLabel: completionRateLabel(c.completed_jobs, c.cancelled_jobs),
      upcomingJobs: c.upcoming_jobs,
      completedThisWeek: c.completed_this_week,
      lifetimeEarningsLabel: canViewPayments ? money0(c.cleaner_earnings) : null,
      pendingOwedLabel: canViewPayments ? money0(c.owed_now) : null,
      ratingLabel: "No ratings yet",
    },
    payoutHealthDetail: {
      owedNowLabel: canViewPayments ? money0(c.owed_now) : null,
      failedCount: c.payouts_failed_count,
      connect,
    },
  };
}

function toUpcomingVM(j: CleanerUpcomingJob, canViewPayments: boolean): CleanerUpcomingVM {
  return {
    id: j.id,
    dateLabel: `${monthDay(j.scheduled_date)} at ${formatTime(j.scheduled_time)}`,
    service: j.service,
    property: j.property,
    status: j.status,
    priceLabel: canViewPayments ? money2(j.total_price) : null,
  };
}

const PENDING_STATUSES: PendingInviteStatus[] = ["pending", "creating", "failed", "expired"];

function toPendingInviteVM(inv: Invite): PendingInviteRowVM {
  return {
    inviteId: inv.id,
    email: inv.email,
    status: inv.status as PendingInviteStatus,
    invitedLabel: `Invited ${monthDay((inv.sent_at ?? inv.created_at).slice(0, 10))}`,
    canResend: inv.status === "pending" || inv.status === "failed" || inv.status === "expired",
  };
}

type ConfirmKind = "remove" | "bulkDeactivate";
type ConfirmState = { kind: ConfirmKind; ids: string[] } | null;

/**
 * Data + behavior for the Cleaners segment. Mounted by OperatorPeople only once
 * the viewer is allowed to manage cleaners, so the useAdminCleanerScorecards /
 * useCleanerWorkload fetches never run for an unauthorized manager.
 */
export function OperatorCleanersData({
  canViewPayments,
  canEdit,
  segment,
  onSegmentChange,
  showSegmentTabs,
}: {
  canViewPayments: boolean;
  canEdit: boolean;
  segment: PeopleSegment;
  onSegmentChange: (v: PeopleSegment) => void;
  showSegmentTabs: boolean;
}) {
  const { currentOrganizationId, accessToken } = useAuth();
  const router = useRouter();
  const { cleaners, loading, error, refetch } = useAdminCleanerScorecards();
  const { paramId: cleanerParam, setParam: setCleanerParam } = useDetailParam("cleaner");
  const { invites, resend, refetch: refetchInvites } = useInvites(
    currentOrganizationId,
    accessToken,
    { enabled: true },
  );

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CleanerSort>("name");
  const [showBenched, setShowBenched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy] = useState(false);

  const { upcoming: detailUpcoming, loading: detailsLoading } = useCleanerWorkload(detailId);

  // Org-level percent, used only to PREFILL the sheet's percent field the first
  // time an unconfigured cleaner's pay is set. Never applied on its own.
  const { data: percentPrefill } = useOrgQuery({
    queryKey: ["operator-cleaners", "percent-prefill", currentOrganizationId ?? ""],
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from("organizations")
        .select("default_cleaner_payout_percent")
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw error;
      const v = (data as { default_cleaner_payout_percent: number | string | null } | null)
        ?.default_cleaner_payout_percent;
      return v == null ? null : Number(v);
    },
  });

  const derived = useMemo(
    () => deriveCleaners(cleaners, { search, sort, showBenched }),
    [cleaners, search, sort, showBenched],
  );
  const rows: CleanerRowVM[] = useMemo(
    () => derived.map((c) => toRowVM(c, canViewPayments)),
    [derived, canViewPayments],
  );

  const totalActiveCount = useMemo(() => cleaners.filter((c) => !c.deactivated_at).length, [cleaners]);
  const benchedCount = useMemo(() => cleaners.filter((c) => c.deactivated_at).length, [cleaners]);

  const pendingInvites: PendingInviteRowVM[] = useMemo(
    () =>
      invites
        .filter((i) => i.role === "cleaner" && PENDING_STATUSES.includes(i.status as PendingInviteStatus))
        .map(toPendingInviteVM),
    [invites],
  );

  // Keep the selection scoped to what is currently visible, so a hidden cleaner
  // can never be caught by a bulk action.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [rows]);

  const detail = useMemo(() => {
    if (!detailId) return null;
    const c = cleaners.find((x) => x.id === detailId);
    return c ? toDetailVM(c, canViewPayments) : null;
  }, [detailId, cleaners, canViewPayments]);

  const detailUpcomingVM = useMemo(
    () => detailUpcoming.map((j) => toUpcomingVM(j, canViewPayments)),
    [detailUpcoming, canViewPayments],
  );

  // --- selection ---
  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected = rows.length > 0 && rows.every((r) => next.has(r.id));
      if (everySelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }, [rows]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // --- detail open/close (URL-synced for deep links) ---
  const openDetail = useCallback(
    (id: string) => {
      setEditing(false);
      setDetailId(id);
      setCleanerParam(id);
    },
    [setCleanerParam],
  );
  const closeDetail = useCallback(() => {
    setEditing(false);
    setDetailId(null);
    setCleanerParam(null);
  }, [setCleanerParam]);

  // Keep the detail in sync with the `?cleaner=<id>` deep link: open it when the
  // param is present and close it when the param is removed (e.g. browser Back).
  useEffect(() => {
    setDetailId(cleanerParam);
  }, [cleanerParam]);

  // --- mutations ---
  const handleSave = useCallback(
    async (fields: CleanerSaveFields): Promise<boolean> => {
      if (!detailId) return false;
      setBusy(true);
      try {
        const r = await updateCleaner({
          cleanerId: detailId,
          profile: {
            first_name: fields.first_name,
            last_name: fields.last_name,
            email: fields.email,
            phone: fields.phone,
          },
          cleaner: {
            payout_percent: fields.payout_percent,
            payout_model: fields.payout_model,
            flat_rate_cents: fields.flat_rate_cents,
            hourly_rate: fields.hourly_rate ?? undefined,
            experience_years: fields.experience_years ?? undefined,
          },
        });
        if (r.success) {
          await refetch();
          toast.success("Cleaner updated");
          return true;
        }
        toast.error(r.error || "Could not update the cleaner");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [detailId, refetch],
  );

  const handleInvite = useCallback(
    async (email: string): Promise<boolean> => {
      if (!currentOrganizationId) return false;
      setBusy(true);
      try {
        const r = await inviteTeamMember({
          email,
          role: "cleaner",
          organizationId: currentOrganizationId,
          accessToken,
        });
        if (r.success) {
          await refetchInvites();
          toast.success("Invite sent", { description: `${email} will appear here once they accept.` });
          return true;
        }
        toast.error(r.error || "Could not send the invite");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, accessToken, refetchInvites],
  );

  const handleInviteAction = useCallback(
    async (inviteId: string, action: InviteRowAction) => {
      if (!currentOrganizationId) return;
      setBusy(true);
      try {
        if (action === "resend") {
          const inv = invites.find((i) => i.id === inviteId);
          if (!inv) return;
          const r = await resend(inv);
          if (r.success) { toast.success("Invite resent"); } else { toast.error(r.error || "Could not resend the invite"); }
        } else if (action === "cancel") {
          const r = await cancelInvite(inviteId, currentOrganizationId, accessToken);
          await refetchInvites();
          if (r.success) { toast.success("Invite canceled"); } else { toast.error(r.error || "Could not cancel the invite"); }
        }
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, accessToken, invites, resend, refetchInvites],
  );

  const doDeactivate = useCallback(
    async (id: string, deactivated: boolean) => {
      setBusy(true);
      try {
        const r = await updateCleaner({ cleanerId: id, deactivated });
        if (r.success) {
          await refetch();
          toast.success(deactivated ? "Cleaner deactivated" : "Cleaner reactivated");
        } else {
          toast.error(r.error || "Could not update the cleaner");
        }
      } finally {
        setBusy(false);
      }
    },
    [refetch],
  );

  const runConfirm = useCallback(async () => {
    if (!confirm) return;
    const { kind, ids } = confirm;
    setBusy(true);
    try {
      if (kind === "remove") {
        const r = await deleteCleanerById(ids[0]);
        await refetch();
        if (r.success) {
          toast.success("Cleaner removed");
          closeDetail();
        } else {
          toast.error(r.error || "Could not remove the cleaner");
        }
      } else if (kind === "bulkDeactivate") {
        let ok = 0;
        let fail = 0;
        for (const id of ids) {
          const r = await updateCleaner({ cleanerId: id, deactivated: true });
          if (r.success) ok += 1;
          else fail += 1;
        }
        await refetch();
        clearSelection();
        const msg = `Deactivated ${ok} cleaner${ok === 1 ? "" : "s"}${fail ? `, ${fail} failed` : ""}`;
        if (fail && !ok) { toast.error(msg); } else { toast.success(msg); }
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }, [confirm, refetch, clearSelection, closeDetail]);

  const handleRowAction = useCallback(
    (id: string, action: CleanerRowAction) => {
      if (action === "open") openDetail(id);
      else if (action === "edit") {
        openDetail(id);
        setEditing(true);
      } else if (action === "deactivate") void doDeactivate(id, true);
      else if (action === "reactivate") void doDeactivate(id, false);
      else if (action === "remove") setConfirm({ kind: "remove", ids: [id] });
    },
    [openDetail, doDeactivate],
  );

  const confirmCopy = useMemo(() => {
    if (!confirm) return null;
    const n = confirm.ids.length;
    if (confirm.kind === "remove") {
      return {
        title: "Remove this cleaner?",
        description:
          "This removes their profile and account access. A cleaner with active jobs cannot be removed until those are reassigned or completed. To keep their history, deactivate them instead.",
        confirmLabel: "Remove",
      };
    }
    return {
      title: `Deactivate ${n} cleaner${n === 1 ? "" : "s"}?`,
      description:
        "Deactivated cleaners are benched: they stay off the active roster and out of new assignments, but keep their history. You can reactivate them anytime.",
      confirmLabel: "Deactivate",
    };
  }, [confirm]);

  return (
    <>
      <OperatorCleanersView
        segment={segment}
        onSegmentChange={onSegmentChange}
        showSegmentTabs={showSegmentTabs}
        loading={loading}
        error={Boolean(error)}
        onRetry={() => refetch()}
        rows={rows}
        pendingInvites={pendingInvites}
        totalActiveCount={totalActiveCount}
        benchedCount={benchedCount}
        canViewPayments={canViewPayments}
        canEdit={canEdit}
        bulkBusy={busy}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        showBenched={showBenched}
        onToggleBenched={() => setShowBenched((v) => !v)}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        onClearSelection={clearSelection}
        onOpenRow={openDetail}
        onRowAction={handleRowAction}
        onInviteAction={handleInviteAction}
        onBulkDeactivate={() => setConfirm({ kind: "bulkDeactivate", ids: [...selectedIds] })}
        onNewCleaner={() => setAddOpen(true)}
      />

      <CleanerDetailSheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) closeDetail();
        }}
        detail={detail}
        upcoming={detailUpcomingVM}
        detailsLoading={detailsLoading}
        canViewPayments={canViewPayments}
        canEdit={canEdit}
        busy={busy}
        editing={editing}
        onEditingChange={setEditing}
        onSave={handleSave}
        onDeactivate={() => detail && void doDeactivate(detail.id, true)}
        onReactivate={() => detail && void doDeactivate(detail.id, false)}
        onRemove={() => detail && setConfirm({ kind: "remove", ids: [detail.id] })}
        onMessage={
          // detail.id is the cleaner_profiles id = the cleaner's user id, which
          // is exactly the ?to= the Messages screen resolves into a thread.
          detail ? () => router.push(`/admin/messages?to=${detail.id}`) : undefined
        }
        percentPrefill={percentPrefill ?? null}
      />

      <AddCleanerDialog open={addOpen} onOpenChange={setAddOpen} busy={busy} onInvite={handleInvite} />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirmCopy?.title ?? ""}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        destructive
        loading={busy}
        onConfirm={runConfirm}
      />
    </>
  );
}
