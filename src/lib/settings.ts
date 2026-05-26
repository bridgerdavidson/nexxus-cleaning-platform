import { User, ShieldCheck, Bell, DollarSign, CreditCard, LucideIcon } from 'lucide-react';

export type SettingsSectionId = 'profile' | 'security' | 'notifications' | 'payouts' | 'billing';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  roles?: string[]; // If undefined, available to all roles
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: User,
  },
  {
    id: 'payouts',
    label: 'Payouts',
    icon: DollarSign,
    roles: ['cleaner'],
  },
  {
    // Tenant (cleaning company) Stripe Connect onboarding — the org becomes the
    // merchant of record for homeowner charges. Admin/owner only.
    id: 'billing',
    label: 'Payments',
    icon: CreditCard,
    roles: ['admin', 'owner'],
  },
  {
    id: 'security',
    label: 'Security',
    icon: ShieldCheck,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
  },
];

/**
 * Sections visible to a user. Pass BOTH the UserRole (drives dashboards) and the OrgRole
 * (drives in-org permissions): a section is shown if either matches. This is why the Payments
 * section (`roles: ['admin','owner']`) reaches an org owner whose UserRole isn't `admin` —
 * `owner` only exists as an OrgRole. Matching is additive, so passing the org role can only
 * reveal sections, never hide them.
 */
export function getSectionsForRole(role?: string, orgRole?: string): SettingsSection[] {
  const roles = [role, orgRole].filter((r): r is string => !!r);
  if (roles.length === 0) return SETTINGS_SECTIONS.filter((s) => !s.roles);
  return SETTINGS_SECTIONS.filter((s) => !s.roles || s.roles.some((r) => roles.includes(r)));
}
