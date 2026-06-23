// View-model types for the "Staff" segment (managers + admins + owner) of the
// Operator "Cleaners & team" screen. Cleaners live in the sibling segment; these
// are the back-office staff, managed for ACCESS (the 15 manager_permissions
// flags + role) rather than for jobs/payouts.

import type { ManagerPermissions } from "@/hooks/useAdminData";

export type StaffRole = "owner" | "admin" | "manager";
export type PeopleSegment = "cleaners" | "staff";
export type StaffRowAction = "open" | "permissions" | "remove";

/** Staff invite statuses shown in the Staff segment's Pending group. */
export type StaffInviteStatus = "pending" | "creating" | "failed" | "expired";

export type StaffRowVM = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
  role: StaffRole;
  roleLabel: string; // "Owner" / "Admin" / "Manager"
  /** "Full access" (owner/admin) / "12 of 15 permissions" / "No permissions yet". */
  accessLabel: string;
  sinceLabel: string; // "Since Jun 2025"
  isOwner: boolean;
  isSelf: boolean;
};

export type StaffPendingInviteVM = {
  inviteId: string;
  email: string;
  roleLabel: string; // "Manager" / "Admin"
  status: StaffInviteStatus;
  invitedLabel: string;
  canResend: boolean;
};

export type StaffDetailVM = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  initials: string;
  role: StaffRole;
  roleLabel: string;
  sinceLabel: string;
  isOwner: boolean;
  isSelf: boolean;
  /** Manager permission flags; null for owner/admin (full access, nothing to edit). */
  permissions: ManagerPermissions | null;
};
