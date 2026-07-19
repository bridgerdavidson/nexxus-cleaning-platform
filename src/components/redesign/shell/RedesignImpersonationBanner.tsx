'use client';

import { useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

/**
 * Design-system impersonation banner for the redesign shells. Shown while a
 * platform admin is "viewing as" a tenant; Exit clears impersonation and returns
 * to the redesign owner back-office. Theme-aware (caution tokens), announced via
 * aria-live. Renders nothing when not impersonating. The legacy amber banner in
 * LayoutWrapper suppresses itself on the redesign roots (/admin, /cleaner,
 * /homeowner, /owner) so this is the only one on redesign routes.
 */
export function RedesignImpersonationBanner() {
  const { impersonatingOrgId, impersonatingOrgName, stopImpersonation } = useAuth();
  const router = useRouter();

  if (!impersonatingOrgId) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b border-caution/50 bg-caution-50 px-4 py-2 text-center text-sm font-medium text-caution-700"
    >
      <span className="inline-flex items-center gap-2">
        <Eye className="size-4 shrink-0" aria-hidden />
        Viewing as <strong>{impersonatingOrgName ?? 'tenant'}</strong> (read-only)
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          stopImpersonation();
          router.push('/owner');
        }}
      >
        <LogOut /> Exit
      </Button>
    </div>
  );
}
