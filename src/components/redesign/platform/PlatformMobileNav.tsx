'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PLATFORM_NAV } from './platform-nav';

/**
 * Mobile bottom nav for the platform back-office (two destinations). The account
 * menu / Sign out lives in the top bar, which stays visible on mobile, so this
 * bar is nav-only. Hidden on desktop where the rail takes over.
 */
export function PlatformMobileNav({ activeId }: { activeId?: string }) {
  return (
    <nav
      aria-label="Platform"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-border bg-card lg:hidden"
    >
      {PLATFORM_NAV.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeId;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'text-brand-600' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
