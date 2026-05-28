'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Loader2, Mail, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useAdminTeamMembers } from '@/hooks/useAdminData';
import { sectionVisibleToRole } from '@/lib/settings';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';

export default function TeamSettingsPage() {
  const router = useRouter();
  const { user, currentOrgRole, loading: authLoading } = useAuth();
  const { permissions } = useManagerPermissions();
  const { teamMembers, loading, error } = useAdminTeamMembers();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!sectionVisibleToRole('team', user.role, currentOrgRole ?? undefined, permissions)) {
      router.replace('/settings');
    }
  }, [authLoading, user, currentOrgRole, permissions, router]);

  const managers = useMemo(
    () => teamMembers.filter((m) => m.role === 'manager'),
    [teamMembers],
  );

  return (
    <>
      <SettingsPageHeader
        section="Team & permissions"
        title="Team & permissions"
        description="Edit what each manager on your team can see and do. Owners and admins have full access by default."
      />

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error}
        </div>
      ) : managers.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <Users className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <h3 className="text-base font-semibold text-gray-900">No managers yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Invite a manager from your dashboard. Once they accept, you can edit their
            permissions here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {managers.map((m) => {
            const initials = `${m.user_profile?.first_name?.[0] ?? ''}${
              m.user_profile?.last_name?.[0] ?? ''
            }`.toUpperCase() || '?';
            const enabled = m.permissions
              ? Object.values(m.permissions).filter(Boolean).length
              : 0;
            const total = m.permissions ? Object.keys(m.permissions).length : 15;
            return (
              <li key={m.id}>
                <Link
                  href={`/settings/team/${m.id}`}
                  className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-gray-50"
                >
                  {m.user_profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.user_profile.avatar_url}
                      alt=""
                      className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-100">
                      <span className="text-sm font-semibold text-primary-700">{initials}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">
                      {m.user_profile?.first_name} {m.user_profile?.last_name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                      <Mail className="h-3 w-3" />
                      <span className="truncate">{m.user_profile?.email}</span>
                    </div>
                  </div>
                  <div className="hidden flex-shrink-0 items-center gap-1.5 text-xs text-gray-500 sm:flex">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>
                      <span className="font-semibold text-gray-700">{enabled}</span> of {total}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
