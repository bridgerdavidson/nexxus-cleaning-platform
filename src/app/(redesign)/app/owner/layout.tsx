'use client';

import { type ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PlatformShell } from '@/components/redesign/platform/PlatformShell';

function Spinner() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" aria-label="Loading" />
    </div>
  );
}

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

  if (loading || !user || isPlatformAdmin !== true) return <Spinner />;

  return <PlatformShell>{children}</PlatformShell>;
}
