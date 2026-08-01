// src/components/redesign/settings/sections.ts
import { User, Building2, CreditCard, Receipt, Wallet, CalendarClock, Users, Palette, type LucideIcon } from "lucide-react";
import type { ManagerPermissions } from "@/hooks/useAdminData";

export type SettingsSectionId =
  | "profile" | "organization" | "branding" | "payments" | "cancellation" | "payout" | "cleaner-experience" | "business-hours";
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
  { id: "organization", label: "Organization", icon: Building2, group: "account", roles: ["owner"] },
  { id: "branding", label: "Branding", icon: Palette, group: "business", roles: ["owner", "admin"] },
  { id: "payments", label: "Payments", icon: CreditCard, group: "business", roles: ["admin", "owner", "manager"], managerPermission: "can_manage_payments" },
  { id: "cancellation", label: "Cancellation policy", icon: Receipt, group: "business", roles: ["admin", "owner"] },
  { id: "payout", label: "Payout settings", icon: Wallet, group: "business", roles: ["owner"] },
  { id: "cleaner-experience", label: "Cleaner experience", icon: Users, group: "business", roles: ["admin", "owner"] },
  { id: "business-hours", label: "Business hours", icon: CalendarClock, group: "business", roles: ["admin", "owner"] },
];

/** Mirrors src/lib/settings.ts getSectionsForRole: additive role match, manager narrowed by permission. */
export function deriveSettingsSections(
  role?: string,
  orgRole?: string,
  permissions?: ManagerPermissions | null,
): RedesignSettingsSection[] {
  const roles = [role, orgRole].filter((r): r is string => !!r);
  return REDESIGN_SETTINGS_SECTIONS.filter((section) => {
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
