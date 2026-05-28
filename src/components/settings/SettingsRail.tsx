'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import {
  SETTINGS_GROUPS,
  type SettingsGroup,
  type SettingsSection,
  getSectionsForRole,
} from '@/lib/settings';

/**
 * Persistent left rail on desktop (>= md). Returns null below md — the section
 * pages render their own header-back-arrow, and `/settings` itself swaps to the
 * mobile menu list.
 */
export default function SettingsRail() {
  const pathname = usePathname();
  const { user, currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();

  const role = user?.role;
  const orgRole = currentOrgRole ?? undefined;
  const sections = getSectionsForRole(role, orgRole, permissions);
  const grouped = groupSections(sections);
  const dashboardHref = role ? `/${role}-dashboard` : '/';

  return (
    <aside className="hidden border-r border-gray-200 bg-white px-3 py-6 md:block md:w-60 lg:w-64">
      <Link
        href={dashboardHref}
        className="mb-5 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <nav aria-label="Settings sections">
        {SETTINGS_GROUPS.map((group) => {
          const items = grouped[group.id];
          if (!items?.length) return null;
          return (
            <div key={group.id} className="mb-4">
              <h2 className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {items.map((section) => (
                  <li key={section.id}>
                    <RailLink section={section} active={pathname === section.href} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function RailLink({
  section,
  active,
}: {
  section: SettingsSection;
  active: boolean;
}) {
  const Icon = section.icon;
  return (
    <Link
      href={section.href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'flex items-center gap-2.5 rounded-lg bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-700 shadow-[inset_3px_0_0_var(--tw-shadow-color)] shadow-primary-600'
          : 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50'
      }
    >
      <Icon
        className={`h-4 w-4 ${active ? 'text-primary-600' : 'text-gray-400'}`}
        aria-hidden="true"
      />
      <span className="flex-1">{section.label}</span>
      {section.comingSoon ? (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
          Soon
        </span>
      ) : null}
    </Link>
  );
}

function groupSections(
  sections: SettingsSection[],
): Record<SettingsGroup, SettingsSection[]> {
  const grouped: Record<SettingsGroup, SettingsSection[]> = {
    account: [],
    business: [],
    earnings: [],
  };
  for (const s of sections) grouped[s.group].push(s);
  return grouped;
}
