'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OperatorRail } from '@/components/redesign/shell/OperatorRail';
import { PlatformTopBar } from './PlatformTopBar';
import { PlatformMobileNav } from './PlatformMobileNav';
import { TenantDetailHost } from './TenantDetailHost';
import { RedesignImpersonationBanner } from '@/components/redesign/shell/RedesignImpersonationBanner';
import { PLATFORM_NAV } from './platform-nav';

function deriveActive(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  // Longest matching href wins so /app/owner/audit resolves to "audit", not
  // "tenants" (whose /app/owner href is a prefix of it).
  let best: { id: string; len: number } | undefined;
  for (const item of PLATFORM_NAV) {
    const roots = [item.href, ...(item.activeFor ?? [])];
    for (const root of roots) {
      if (pathname === root || pathname.startsWith(root + '/')) {
        if (!best || root.length > best.len) best = { id: item.id, len: root.length };
      }
    }
  }
  return best?.id;
}

/**
 * Platform-owner back-office shell: reuses the operator brand rail (desktop) with
 * the platform destinations, a lean top bar (account menu), and a mobile bottom
 * nav. Renders {children} in the content area. Auth gating (isPlatformAdmin)
 * lives in the route layout that mounts this.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeId = deriveActive(pathname);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:shadow-soft-md focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <OperatorRail activeId={activeId} nav={PLATFORM_NAV} />
        <div className="lg:pl-16">
          <RedesignImpersonationBanner />
          <PlatformTopBar />
          <main id="main-content" className="px-4 pb-28 pt-5 lg:px-6 lg:pb-10">
            {/* Keyed by pathname so each page switch replays the entrance animation
                while the shell chrome stays put. */}
            <div key={pathname} className="animate-page-in motion-reduce:animate-none">
              {children}
            </div>
          </main>
        </div>
        <PlatformMobileNav activeId={activeId} />
        <Suspense fallback={null}>
          <TenantDetailHost />
        </Suspense>
      </div>
    </TooltipProvider>
  );
}
