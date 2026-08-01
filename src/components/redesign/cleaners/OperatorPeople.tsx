"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { replaceSearchShallow } from "@/lib/shallowSearch";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { EmptyState } from "@/components/ui/empty-state";
import { OperatorCleanersData } from "./OperatorCleaners";
import { OperatorStaffData } from "./OperatorStaff";
import type { PeopleSegment } from "./staff-types";

/**
 * Gate + segment shell for the operator "Cleaners & team" screen. The screen is
 * a Cleaners workspace plus a Staff (managers/admins/owner) view, toggled by a
 * segment control. Cleaner roster data is an app-level grant (not RLS), so we
 * gate before mounting either data component. The Staff segment is owner/admin
 * only: a manager who can only manage cleaners never sees the toggle.
 */
export function OperatorPeople() {
  const { currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canManageCleaners = privileged || !!permissions?.can_manage_cleaners;
  const canViewStaff = privileged;

  const view: PeopleSegment =
    canViewStaff && searchParams.get("view") === "staff" ? "staff" : "cleaners";

  const setView = useCallback(
    (v: PeopleSegment) => {
      const params = new URLSearchParams(searchParams.toString());
      if (v === "staff") params.set("view", "staff");
      else params.delete("view");
      const qs = params.toString();
      replaceSearchShallow(qs ? `?${qs}` : "?");
    },
    [searchParams],
  );

  if (!privileged && permsLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canManageCleaners) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <EmptyState
          icon={<ShieldAlert />}
          title="You do not have access to cleaners"
          description="Ask an owner or admin to grant you the cleaners permission."
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1700px]">
      {view === "staff" ? (
        <OperatorStaffData
          canManage={privileged}
          segment={view}
          onSegmentChange={setView}
          showSegmentTabs={canViewStaff}
        />
      ) : (
        <OperatorCleanersData
          canViewPayments={privileged || !!permissions?.can_view_payments}
          canEdit={canManageCleaners}
          segment={view}
          onSegmentChange={setView}
          showSegmentTabs={canViewStaff}
        />
      )}
    </div>
  );
}
