'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import {
  SETTINGS_GROUPS,
  type SettingsGroup,
  type SettingsSection,
  getSectionsForRole,
} from '@/lib/settings';

/**
 * Mobile-only menu list shown at `/settings` below the md: breakpoint.
 * Identity row on top + grouped tappable rows. Tapping a row navigates to
 * /settings/[section]; native back returns here.
 */
export default function MobileSettingsMenu() {
  const { user, currentOrgRole, signOut } = useAuth();
  const { permissions } = useManagerPermissions();

  const role = user?.role;
  const orgRole = currentOrgRole ?? undefined;
  const sections = getSectionsForRole(role, orgRole, permissions);
  const grouped = groupSections(sections);
  const dashboardHref = role ? `/${role}-dashboard` : '/';
  const displayName = user
    ? `${user.profile?.firstName ?? ''} ${user.profile?.lastName ?? ''}`.trim() ||
      user.email
    : '';

  return (
    <div className="md:hidden">
      <div className="border-b border-gray-200 bg-white px-4 py-4">
        <Link
          href={dashboardHref}
          className="mb-3 -ml-2 inline-flex items-center gap-1 rounded-md p-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Settings</h1>
      </div>

      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-4">
        <div
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-600 to-primary-500 text-lg font-bold text-white"
          aria-hidden="true"
        >
          {displayName.charAt(0).toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-gray-900">{displayName}</div>
          <div className="truncate text-xs text-gray-500">
            {user?.email} {role ? `· ${capitalize(role)}` : ''}
          </div>
        </div>
      </div>

      <nav aria-label="Settings sections" className="bg-white">
        {SETTINGS_GROUPS.map((group) => {
          const items = grouped[group.id];
          if (!items?.length) return null;
          return (
            <div key={group.id}>
              <h2 className="border-b border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                {group.label}
              </h2>
              <ul>
                {items.map((s) => (
                  <li key={s.id}>
                    <MenuRow section={s} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-2 flex w-full items-center gap-3 border-b border-t border-gray-200 bg-white px-4 py-4 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
          Log out
        </button>
      </nav>
    </div>
  );
}

function MenuRow({ section }: { section: SettingsSection }) {
  const Icon = section.icon;
  return (
    <Link
      href={section.href}
      className="flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-4 text-sm font-medium text-gray-700 transition active:bg-gray-50"
    >
      <Icon className="h-5 w-5 text-gray-400" aria-hidden="true" />
      <span className="flex-1">{section.label}</span>
      {section.comingSoon ? (
        <span className="text-[11px] font-semibold text-gray-400">Soon</span>
      ) : (
        <ChevronRight className="h-4 w-4 text-gray-300" aria-hidden="true" />
      )}
    </Link>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
