'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import type { ManagerPermissionKey } from '@/lib/permissions/managerFlags';

export function useRequireManagerFlag(flag: ManagerPermissionKey): 'checking' | 'allowed' {
  const router = useRouter();
  const { user, loading: authLoading, currentOrgRole, currentOrganizationId } = useAuth();
  const { permissions } = useManagerPermissions();

  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  // Auth/org not yet resolved -> we do not know the role/org yet.
  const authResolved = !authLoading && !!user && !!currentOrganizationId && currentOrgRole != null;
  // For a manager, permissions are unknown until the query returns a non-null object.
  const resolving = !authResolved || (!privileged && permissions == null);

  useEffect(() => {
    if (resolving) return;            // wait for auth + (managers) permissions
    if (privileged) return;           // owner/admin bypass
    if (!permissions?.[flag]) router.replace('/app/admin-dashboard');
  }, [resolving, privileged, permissions, flag, router]);

  if (resolving) return 'checking';
  if (privileged) return 'allowed';
  return permissions?.[flag] ? 'allowed' : 'checking';
}
