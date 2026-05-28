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
 * Persistent left rail on desktop (>= md). Hidden below md — the section
 * pages render their own header back-arrow, and `/settings` itself swaps to
 * the mobile menu list.
 *
 * Visual treatment matches the dashboard's `<DesktopSidebar>` so the chrome
 * feels continuous: bg-gray-50 panel, items use the same active/hover states
 * (white card + primary ring + left yellow bar).
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
    <aside className="hidden md:flex md:flex-col md:w-[260px] flex-shrink-0 bg-gray-50">
      <div className="px-6 pt-6 pb-2">
        <Link
          href={dashboardHref}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-white/80 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </div>

      <nav aria-label="Settings sections" className="flex-1 overflow-y-auto px-3 pb-6">
        {SETTINGS_GROUPS.map((group) => {
          const items = grouped[group.id];
          if (!items?.length) return null;
          return (
            <div key={group.id} className="mt-4 first:mt-2">
              <h2 className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </h2>
              <ul className="space-y-1">
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
      className={`relative flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${
        active
          ? 'bg-white text-primary-700 ring-1 ring-primary-100/80'
          : 'text-gray-600 hover:bg-white/80 hover:text-gray-900'
      }`}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-600 rounded-r-full" />
      )}
      <Icon
        className={`flex-shrink-0 w-5 h-5 mr-3 ${
          active ? 'text-primary-600' : 'text-gray-400'
        }`}
        aria-hidden="true"
      />
      <span
        className={`flex-1 text-sm truncate ${
          active ? 'font-semibold' : 'font-medium'
        }`}
      >
        {section.label}
      </span>
      {section.comingSoon ? (
        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
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
