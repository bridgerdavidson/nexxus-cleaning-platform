'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/** Back-to-hub header for an Account sub-page (phone-first). */
export function AccountSubHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center gap-1">
      <Link
        href="/app/homeowner-dashboard/account"
        aria-label="Back to account"
        className="-ml-2 grid size-9 place-items-center rounded-control text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-6" />
      </Link>
      <h1 className="text-xl font-bold">{title}</h1>
    </div>
  );
}
