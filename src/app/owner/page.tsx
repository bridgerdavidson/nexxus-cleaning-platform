'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PlatformOverviewPage } from '@/components/platform/PlatformOverviewPage';

/**
 * Platform-owner back-office (Nexxus staff). Guard-only shell — the tenant
 * overview component lands in Section C. Access is gated three ways:
 *  - not signed in  -> /login
 *  - signed in, confirmed NOT a platform admin -> home
 *  - check still pending (isPlatformAdmin === null) -> loading (never bounce)
 */
export default function OwnerDashboardPage() {
  const { user, loading, isPlatformAdmin } = useAuth();
  const router = useRouter();

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

  if (loading || !user || isPlatformAdmin !== true) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-secondary-400" />
      </div>
    );
  }

  return <PlatformOverviewPage />;
}
