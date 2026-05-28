import {
  User,
  ShieldCheck,
  Bell,
  DollarSign,
  CreditCard,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import type { ManagerPermissions } from '@/hooks/useAdminData';

export type SettingsSectionId =
  | 'profile'
  | 'security'
  | 'notifications'
  | 'payouts'
  | 'payments'
  | 'cancellation-policy';

export type SettingsGroup = 'account' | 'business' | 'earnings';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  /** Pathname this section lives at — server- and client-side use this for routing. */
  href: string;
  /** UI grouping in the rail / mobile menu. */
  group: SettingsGroup;
  /** UserRole / OrgRole strings that may see this section. Undefined = visible to all. */
  roles?: string[];
  /** Manager permission flag required when OrgRole is 'manager'. Other roles bypass. */
  managerPermission?: keyof ManagerPermissions;
  /** Render the "Soon" badge + a placeholder body. */
  comingSoon?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: User,
    href: '/settings/profile',
    group: 'account',
  },
  {
    id: 'security',
    label: 'Security',
    icon: ShieldCheck,
    href: '/settings/security',
    group: 'account',
    comingSoon: true,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    href: '/settings/notifications',
    group: 'account',
    comingSoon: true,
  },
  {
    // Tenant (cleaning company) Stripe Connect — the org is the merchant of record.
    // Visible to admins/owners; managers see it only with can_manage_payments.
    id: 'payments',
    label: 'Payments',
    icon: CreditCard,
    href: '/settings/payments',
    group: 'business',
    roles: ['admin', 'owner', 'manager'],
    managerPermission: 'can_manage_payments',
  },
  {
    // Pulled out of Payments so it can never get pushed around by Stripe's iframe.
    id: 'cancellation-policy',
    label: 'Cancellation policy',
    icon: Receipt,
    href: '/settings/cancellation-policy',
    group: 'business',
    roles: ['admin', 'owner', 'manager'],
    managerPermission: 'can_manage_payments',
  },
  {
    // Cleaner Stripe Connect payouts.
    id: 'payouts',
    label: 'Payouts',
    icon: DollarSign,
    href: '/settings/payouts',
    group: 'earnings',
    roles: ['cleaner'],
  },
];

/**
 * Sections visible to a user. Pass:
 *  - `role` — the UserRole on `user_profiles.role` (drives which dashboard)
 *  - `orgRole` — the OrgRole on `organization_members.role` (drives in-org permissions)
 *  - `permissions` — the manager-permissions row (only consulted when orgRole === 'manager')
 *
 * Matching is additive: a section is shown if its `roles` intersects {role, orgRole}.
 * Manager permission flags then narrow the manager case further.
 */
export function getSectionsForRole(
  role?: string,
  orgRole?: string,
  permissions?: ManagerPermissions | null,
): SettingsSection[] {
  const roles = [role, orgRole].filter((r): r is string => !!r);
  return SETTINGS_SECTIONS.filter((section) => {
    if (section.roles && !section.roles.some((r) => roles.includes(r))) return false;
    if (orgRole === 'manager' && section.managerPermission) {
      if (!permissions || !permissions[section.managerPermission]) return false;
    }
    return true;
  });
}

/**
 * True if the given section is visible to a user with the given roles/permissions.
 * Used by section pages for client-side role gating (redirect when forbidden).
 */
export function sectionVisibleToRole(
  sectionId: SettingsSectionId,
  role?: string,
  orgRole?: string,
  permissions?: ManagerPermissions | null,
): boolean {
  return getSectionsForRole(role, orgRole, permissions).some((s) => s.id === sectionId);
}

/**
 * Default landing section for a role — owner/admin land on Payments (the heaviest config),
 * cleaners on Payouts, everyone else on Profile.
 */
export function defaultSectionForRole(role?: string, orgRole?: string): SettingsSectionId {
  if (orgRole === 'owner' || orgRole === 'admin') return 'payments';
  if (role === 'cleaner') return 'payouts';
  return 'profile';
}

export interface SettingsGroupSpec {
  id: SettingsGroup;
  label: string;
}

export const SETTINGS_GROUPS: SettingsGroupSpec[] = [
  { id: 'account', label: 'Account' },
  { id: 'business', label: 'Business' },
  { id: 'earnings', label: 'Earnings' },
];
