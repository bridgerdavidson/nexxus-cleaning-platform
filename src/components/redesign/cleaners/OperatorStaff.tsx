"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/contexts/ToastContext";
import { useInvites } from "@/hooks/useInvites";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useAdminStaff,
  updateManagerPermissions,
  inviteTeamMember,
  deleteTeamMember,
  cancelInvite,
  type AdminStaffMember,
  type ManagerPermissions,
} from "@/hooks/useAdminData";
import type { Invite } from "@/types";
import { OperatorStaffView } from "./OperatorStaffView";
import { StaffDetailSheet, PERMISSION_KEYS } from "./StaffDetailSheet";
import { AddStaffDialog, type StaffInviteRole } from "./AddStaffDialog";
import type {
  PeopleSegment,
  StaffDetailVM,
  StaffInviteStatus,
  StaffPendingInviteVM,
  StaffRole,
  StaffRowAction,
  StaffRowVM,
} from "./staff-types";
import type { InviteRowAction } from "./cleaners-types";

// --- formatting helpers (AdminStaffMember -> view-model) ---

function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function monthDay(dateStr: string): string {
  const d = new Date(`${(dateStr ?? "").slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr ?? "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function nameOf(s: AdminStaffMember): string {
  const n = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
  return n || s.email;
}
function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return (email[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
const ROLE_LABEL: Record<StaffRole, string> = { owner: "Owner", admin: "Admin", manager: "Manager" };

function accessLabel(s: AdminStaffMember): string {
  if (s.role !== "manager") return "Full access";
  if (!s.permissions) return "No permissions yet";
  const enabled = PERMISSION_KEYS.filter((k) => s.permissions![k]).length;
  return `${enabled} of ${PERMISSION_KEYS.length} permissions`;
}

function toRowVM(s: AdminStaffMember, currentUserId: string | undefined): StaffRowVM {
  const name = nameOf(s);
  const hasName = name !== s.email;
  return {
    id: s.id,
    name,
    email: s.email,
    avatarUrl: s.avatar_url,
    initials: initials(hasName ? name : "", s.email),
    role: s.role,
    roleLabel: ROLE_LABEL[s.role],
    accessLabel: accessLabel(s),
    sinceLabel: `Since ${monthYear(s.created_at)}`,
    isOwner: s.role === "owner",
    isSelf: s.id === currentUserId,
  };
}

function toDetailVM(s: AdminStaffMember, currentUserId: string | undefined): StaffDetailVM {
  const name = nameOf(s);
  const hasName = name !== s.email;
  return {
    id: s.id,
    name,
    email: s.email,
    avatarUrl: s.avatar_url,
    initials: initials(hasName ? name : "", s.email),
    role: s.role,
    roleLabel: ROLE_LABEL[s.role],
    sinceLabel: monthYear(s.created_at),
    isOwner: s.role === "owner",
    isSelf: s.id === currentUserId,
    permissions: s.permissions,
  };
}

const PENDING_STATUSES: StaffInviteStatus[] = ["pending", "creating", "failed", "expired"];
const STAFF_ROLES = new Set(["manager", "admin"]);

function toPendingInviteVM(inv: Invite): StaffPendingInviteVM {
  return {
    inviteId: inv.id,
    email: inv.email,
    roleLabel: inv.role === "admin" ? "Admin" : "Manager",
    status: inv.status as StaffInviteStatus,
    invitedLabel: `Invited ${monthDay(inv.sent_at ?? inv.created_at)}`,
    canResend: inv.status === "pending" || inv.status === "failed" || inv.status === "expired",
  };
}

function matchesSearch(s: AdminStaffMember, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return [nameOf(s), s.email].join(" ").toLowerCase().includes(query);
}

/** Staff segment (managers + admins + owner). Only rendered for owner/admin
 *  (canManage); a manager who can only manage cleaners never sees this. */
export function OperatorStaffData({
  canManage,
  segment,
  onSegmentChange,
  showSegmentTabs,
}: {
  canManage: boolean;
  segment: PeopleSegment;
  onSegmentChange: (v: PeopleSegment) => void;
  showSegmentTabs: boolean;
}) {
  const { showToast } = useToast();
  const { user, currentOrganizationId, accessToken } = useAuth();
  const { staff, loading, refetch } = useAdminStaff();
  const { invites, resend, refetch: refetchInvites } = useInvites(
    currentOrganizationId,
    accessToken,
    { enabled: true },
  );

  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows: StaffRowVM[] = useMemo(
    () => staff.filter((s) => matchesSearch(s, search)).map((s) => toRowVM(s, user?.id)),
    [staff, search, user?.id],
  );

  const pendingInvites: StaffPendingInviteVM[] = useMemo(
    () =>
      invites
        .filter((i) => STAFF_ROLES.has(i.role) && PENDING_STATUSES.includes(i.status as StaffInviteStatus))
        .map(toPendingInviteVM),
    [invites],
  );

  const detail = useMemo(() => {
    if (!detailId) return null;
    const s = staff.find((x) => x.id === detailId);
    return s ? toDetailVM(s, user?.id) : null;
  }, [detailId, staff, user?.id]);

  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const closeDetail = useCallback(() => setDetailId(null), []);

  const handleSavePermissions = useCallback(
    async (permissions: ManagerPermissions): Promise<boolean> => {
      if (!detailId || !currentOrganizationId) return false;
      setBusy(true);
      try {
        const r = await updateManagerPermissions(detailId, currentOrganizationId, permissions);
        if (r.success) {
          await refetch();
          showToast("Permissions updated", { variant: "success" });
          return true;
        }
        showToast(r.error || "Could not update permissions", { variant: "error" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [detailId, currentOrganizationId, refetch, showToast],
  );

  const handleInvite = useCallback(
    async (email: string, role: StaffInviteRole): Promise<boolean> => {
      if (!currentOrganizationId) return false;
      setBusy(true);
      try {
        const r = await inviteTeamMember({ email, role, organizationId: currentOrganizationId, accessToken });
        if (r.success) {
          await refetchInvites();
          showToast("Invite sent", {
            variant: "success",
            description: `${email} will appear here once they accept.`,
          });
          return true;
        }
        showToast(r.error || "Could not send the invite", { variant: "error" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, accessToken, refetchInvites, showToast],
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
          showToast(r.success ? "Invite resent" : r.error || "Could not resend the invite", {
            variant: r.success ? "success" : "error",
          });
        } else if (action === "cancel") {
          const r = await cancelInvite(inviteId, currentOrganizationId, accessToken);
          await refetchInvites();
          showToast(r.success ? "Invite canceled" : r.error || "Could not cancel the invite", {
            variant: r.success ? "success" : "error",
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [currentOrganizationId, accessToken, invites, resend, refetchInvites, showToast],
  );

  const handleRowAction = useCallback(
    (id: string, action: StaffRowAction) => {
      if (action === "open" || action === "permissions") openDetail(id);
      else if (action === "remove") setConfirmId(id);
    },
    [openDetail],
  );

  const runRemove = useCallback(async () => {
    if (!confirmId || !currentOrganizationId) return;
    setBusy(true);
    try {
      const r = await deleteTeamMember(confirmId, currentOrganizationId);
      await refetch();
      if (r.success) {
        showToast("Removed from team", { variant: "success" });
        if (detailId === confirmId) closeDetail();
      } else {
        showToast(r.error || "Could not remove this member", { variant: "error" });
      }
    } finally {
      setBusy(false);
      setConfirmId(null);
    }
  }, [confirmId, currentOrganizationId, refetch, showToast, detailId, closeDetail]);

  return (
    <>
      <OperatorStaffView
        segment={segment}
        onSegmentChange={onSegmentChange}
        showSegmentTabs={showSegmentTabs}
        loading={loading}
        rows={rows}
        pendingInvites={pendingInvites}
        totalCount={staff.length}
        canManage={canManage}
        busy={busy}
        search={search}
        onSearchChange={setSearch}
        onOpenRow={openDetail}
        onRowAction={handleRowAction}
        onInviteAction={handleInviteAction}
        onNewStaff={() => setAddOpen(true)}
      />

      <StaffDetailSheet
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) closeDetail();
        }}
        detail={detail}
        canManage={canManage}
        busy={busy}
        onSavePermissions={handleSavePermissions}
        onRemove={() => detail && setConfirmId(detail.id)}
      />

      <AddStaffDialog open={addOpen} onOpenChange={setAddOpen} busy={busy} onInvite={handleInvite} />

      <ConfirmDialog
        open={!!confirmId}
        onOpenChange={(o) => {
          if (!o) setConfirmId(null);
        }}
        title="Remove this team member?"
        description="This removes their access to the workspace. You can invite them again later."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={runRemove}
      />
    </>
  );
}
