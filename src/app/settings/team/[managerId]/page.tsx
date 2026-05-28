'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useAdminTeamMembers } from '@/hooks/useAdminData';
import { sectionVisibleToRole } from '@/lib/settings';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import ManagerPermissionsForm from '@/components/settings/ManagerPermissionsForm';

export default function ManagerPermissionsPage() {
  const router = useRouter();
  const params = useParams<{ managerId: string }>();
  const managerId = params?.managerId;
  const { user, currentOrgRole, loading: authLoading } = useAuth();
  const { permissions } = useManagerPermissions();
  const { teamMembers, loading, refetch } = useAdminTeamMembers();

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

  const manager = useMemo(
    () => teamMembers.find((m) => m.id === managerId && m.role === 'manager'),
    [teamMembers, managerId],
  );

  const fullName = manager
    ? [manager.user_profile?.first_name, manager.user_profile?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || manager.user_profile?.email || 'Manager'
    : 'Manager';

  return (
    <>
      <Link
        href="/settings/team"
        className="mb-2 -ml-2 inline-flex items-center gap-1 rounded-md p-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
      >
        <ChevronLeft className="h-4 w-4" />
        Team & permissions
      </Link>
      <SettingsPageHeader
        section="Team & permissions"
        title={fullName}
        description={manager?.user_profile?.email ?? 'Manager permissions'}
      />

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : !manager ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Manager not found</h3>
          <p className="mt-1 text-sm text-gray-500">
            This person may have been removed from your organization.
          </p>
          <Link
            href="/settings/team"
            className="mt-4 inline-block text-sm font-semibold text-primary-700 hover:underline"
          >
            Back to team
          </Link>
        </div>
      ) : (
        <ManagerPermissionsForm manager={manager} onSaved={() => refetch?.()} />
      )}
    </>
  );
}
