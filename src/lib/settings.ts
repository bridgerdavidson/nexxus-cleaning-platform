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
    roles: ['admin'],
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

export function getSectionsForRole(role?: string): SettingsSection[] {
  if (!role) return SETTINGS_SECTIONS.filter((s) => !s.roles);
  return SETTINGS_SECTIONS.filter((s) => !s.roles || s.roles.includes(role));
}
