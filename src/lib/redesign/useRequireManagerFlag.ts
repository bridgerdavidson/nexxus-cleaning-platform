'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import type { ManagerPermissionKey } from '@/lib/permissions/managerFlags';

export function useRequireManagerFlag(flag: ManagerPermissionKey): 'checking' | 'allowed' {
  const router = useRouter();
  const { currentOrgRole } = useAuth();
  const { permissions, loading } = useManagerPermissions();
  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const allowed = privileged || !!permissions?.[flag];

  useEffect(() => {
    if (privileged) return;
    if (loading) return; // wait for the permission row
    if (!permissions?.[flag]) router.replace('/app/admin-dashboard');
  }, [privileged, loading, permissions, flag, router]);

  if (privileged) return 'allowed';
  if (loading) return 'checking';
  return allowed ? 'allowed' : 'checking';
}
