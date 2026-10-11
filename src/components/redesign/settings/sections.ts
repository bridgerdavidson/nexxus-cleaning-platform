// src/components/redesign/settings/sections.ts
import { User, CreditCard, Gem, Receipt, Wallet, CalendarClock, Users, Palette, PanelLeft, type LucideIcon } from "lucide-react";
import type { ManagerPermissions } from "@/hooks/useAdminData";
import { billingEnforcementUiEnabled } from "@/lib/billing/flags";

export type SettingsSectionId =
  | "profile" | "appearance" | "branding" | "payments" | "billing" | "cancellation" | "payout" | "cleaner-experience" | "business-hours";
export type SettingsGroupId = "account" | "business";

export interface RedesignSettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  group: SettingsGroupId;
  /** UserRole/OrgRole strings allowed to see this section; undefined = visible to all. */
  roles?: string[];
  /** Required only when orgRole === 'manager'. Other roles bypass. */
  managerPermission?: keyof ManagerPermissions;
}

export const REDESIGN_SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "business", label: "Business" },
];

export const REDESIGN_SETTINGS_SECTIONS: RedesignSettingsSection[] = [
  { id: "profile", label: "Profile", icon: User, group: "account" },
  { id: "appearance", label: "Appearance", icon: PanelLeft, group: "account" },
  { id: "branding", label: "Branding", icon: Palette, group: "business", roles: ["owner", "admin"] },
  { id: "payments", label: "Payments", icon: CreditCard, group: "business", roles: ["admin", "owner", "manager"], managerPermission: "can_manage_payments" },
  // Gem, not CreditCard: `payments` already owns CreditCard and two identical
  // glyphs in the same nav group are unreadable at a glance.
  // Owner AND admin see the section (ruling R15 v3); the owner-only money
  // controls inside it are disabled with a reason, never hidden.
  { id: "billing", label: "Plan and billing", icon: Gem, group: "business", roles: ["owner", "admin"] },
  { id: "cancellation", label: "Cancellation policy", icon: Receipt, group: "business", roles: ["admin", "owner"] },
  { id: "payout", label: "Payout settings", icon: Wallet, group: "business", roles: ["owner"] },
  { id: "cleaner-experience", label: "Cleaner experience", icon: Users, group: "business", roles: ["admin", "owner"] },
  { id: "business-hours", label: "Business hours", icon: CalendarClock, group: "business", roles: ["admin", "owner"] },
];

/**
 * Sections whose registration is gated on a feature flag, not on a role. The
 * flag is read at call time (never captured at module scope), because a client
 * bundle inlines NEXT_PUBLIC_* at build and a test needs to stub it per case.
 */
function sectionIsFlagged(id: SettingsSectionId): boolean {
  // GLOBAL CONSTRAINT, flag-dark: no billing surface exists until ops flips
  // NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED. Without this the pilot org's owner
  // and admins gain a "Plan and billing" nav item on MERGE day, leading to
  // billingSectionModel's "Billing is not enabled for this account yet.", which
  // is a dead end nobody asked for. The model keeps its own `disabled` branch as
  // defence in depth; this is what stops the nav item appearing at all.
  if (id === "billing") return billingEnforcementUiEnabled();
  return true;
}

/** Mirrors src/lib/settings.ts getSectionsForRole: additive role match, manager narrowed by permission. */
export function deriveSettingsSections(
  role?: string,
  orgRole?: string,
  permissions?: ManagerPermissions | null,
): RedesignSettingsSection[] {
  const roles = [role, orgRole].filter((r): r is string => !!r);
  return REDESIGN_SETTINGS_SECTIONS.filter((section) => {
    if (!sectionIsFlagged(section.id)) return false;
    if (section.roles && !section.roles.some((r) => roles.includes(r))) return false;
    if (orgRole === "manager" && section.managerPermission) {
      if (!permissions || !permissions[section.managerPermission]) return false;
    }
    return true;
  });
}

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "profile";

export function isVisibleSection(
  id: string,
  role?: string,
  orgRole?: string,
  permissions?: ManagerPermissions | null,
): id is SettingsSectionId {
  return deriveSettingsSections(role, orgRole, permissions).some((s) => s.id === id);
}
