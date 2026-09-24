'use client';

import { useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShellBanner } from '@/components/ui/shell-banner';
import { useAuth } from '@/hooks/useAuth';

/**
 * Shown while a platform admin is "viewing as" a tenant. Exit clears
 * impersonation and returns to the redesign owner back-office. Renders nothing
 * when not impersonating. The legacy amber banner in LayoutWrapper suppresses
 * itself on the redesign roots so this is the only one on redesign routes.
 */
export function RedesignImpersonationBanner() {
  const { impersonatingOrgId, impersonatingOrgName, stopImpersonation } = useAuth();
  const router = useRouter();

  if (!impersonatingOrgId) return null;

  return (
    <ShellBanner
      tone="caution"
      icon={<Eye />}
      actions={
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
      }
    >
      Viewing as <strong>{impersonatingOrgName ?? 'tenant'}</strong> (read-only)
    </ShellBanner>
  );
}
