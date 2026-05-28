'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ReactNode } from 'react';

interface SettingsPageHeaderProps {
  /** Lowercased section label for the crumb (e.g. "Payments"). */
  section: string;
  title: string;
  description?: ReactNode;
  /** Optional right-aligned action(s) in the header row. */
  action?: ReactNode;
}

/**
 * Page header for every settings section page. Renders:
 *  - A small back-arrow link to /settings (visible only on mobile, where the rail is hidden)
 *  - A breadcrumb ("Settings · Payments")
 *  - The page title + optional description
 */
export default function SettingsPageHeader({
  section,
  title,
  description,
  action,
}: SettingsPageHeaderProps) {
  return (
    <header className="mb-7">
      <Link
        href="/settings"
        className="mb-2 -ml-2 inline-flex items-center gap-1 rounded-md p-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 md:hidden"
      >
        <ChevronLeft className="h-4 w-4" />
        All settings
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-gray-500">
            Settings · <span className="font-medium text-gray-700">{section}</span>
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-gray-500">{description}</p>
          ) : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
    </header>
  );
}
