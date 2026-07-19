'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Eye, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

/**
 * Persistent banner shown app-wide while a platform admin is "viewing as" a
 * tenant. Makes the impersonation impossible to miss and offers a one-click exit
 * back to the owner dashboard. Renders nothing when not impersonating.
 */
export function ImpersonationBanner() {
  const { impersonatingOrgId, impersonatingOrgName, stopImpersonation } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // The redesign shells render their own design-system impersonation banner;
  // suppress this legacy amber one on the redesign roots so the two never
  // double up. Post-4e the shells live at /admin, /cleaner, /homeowner, /owner
  // (before that they were under /app).
  const onRedesignShell =
    pathname != null &&
    ['/admin', '/cleaner', '/homeowner', '/owner'].some(
      (root) => pathname === root || pathname.startsWith(root + '/'),
    );
  if (!impersonatingOrgId || onRedesignShell) return null;

  return (
    <div className="sticky top-0 z-[100] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Viewing as <strong>{impersonatingOrgName ?? 'tenant'}</strong> (read-only)
      </span>
      <button
        type="button"
        onClick={() => {
          stopImpersonation();
          router.push('/owner');
        }}
        className="inline-flex items-center gap-1 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold transition-colors duration-150 hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        Exit
      </button>
    </div>
  );
}
