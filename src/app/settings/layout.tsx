'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import SettingsRail from '@/components/settings/SettingsRail';

interface SettingsLayoutProps {
  children: ReactNode;
}

/**
 * Shared shell for the entire /settings/* route family.
 *
 * - Desktop (>= md): persistent left rail + scrollable main column.
 * - Mobile (< md):    rail is hidden. `/settings` shows the menu list (rendered
 *                     by app/settings/page.tsx); `/settings/[section]` shows the
 *                     section page alone with a header back-arrow.
 *
 * The rail and the mobile menu are mutually exclusive — never both visible.
 */
export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();
  // On mobile, the /settings root is the full-bleed menu list. Section pages
  // render with comfortable padding.
  const isRoot = pathname === '/settings';
  return (
    <div className="flex min-h-screen bg-gray-50">
      <SettingsRail />
      <main
        className={
          isRoot
            ? 'flex-1'
            : 'flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10 lg:px-12'
        }
      >
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
