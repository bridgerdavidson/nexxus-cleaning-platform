'use client';

import { type ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { PlatformShell } from '@/components/redesign/platform/PlatformShell';
import { FullPageLoader } from '@/components/ui/nexxus-loader';

/**
 * Platform-owner back-office layout. Owns the three-way access guard (mirrors the
 * legacy /owner page) and mounts PlatformShell once for the whole tree so the
 * chrome persists across Tenants <-> Audit navigations:
 *   - not signed in            -> /login
 *   - signed in, NOT an admin  -> /
 *   - check still pending (null) -> spinner, never bounce
 * The (redesign) group's own layout already gates the whole tree behind the
 * redesign flag and sets the theme.
 */
export default function PlatformOwnerLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading, isPlatformAdmin } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (isPlatformAdmin === false) {
      router.replace('/');
    }
  }, [user, loading, isPlatformAdmin, router]);

  if (loading || !user || isPlatformAdmin !== true) return <FullPageLoader />;

  return <PlatformShell>{children}</PlatformShell>;
}
