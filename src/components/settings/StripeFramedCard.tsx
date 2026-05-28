'use client';

import { ReactNode } from 'react';

interface StripeFramedCardProps {
  /** Min-height reserved at all times — eliminates layout shift when Stripe loads. */
  minHeight?: string;
  /** Show the "Powered by Stripe" attribution in the top-right. Default true. */
  showAttribution?: boolean;
  /** When true, render the skeleton state instead of children. */
  loading?: boolean;
  /** Optional skeleton override; defaults to a 4-row table skeleton. */
  skeleton?: ReactNode;
  /** Required when loading is false. */
  children?: ReactNode;
}

/**
 * Container for embedded Stripe Connect components. Two jobs:
 *
 * 1. Visually distinguishes Stripe's UI from ours (dashed border + attribution),
 *    so the user reads the styling difference as intentional, not a bug.
 * 2. Reserves vertical space (default 20rem) so the skeleton state and the loaded
 *    state occupy the same height — siblings on the page never shift around as
 *    the Stripe iframe finishes loading.
 */
export default function StripeFramedCard({
  minHeight = 'min-h-80',
  showAttribution = true,
  loading = false,
  skeleton,
  children,
}: StripeFramedCardProps) {
  return (
    <div
      className={`relative rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 ${minHeight}`}
    >
      {showAttribution && (
        <div className="absolute right-3 top-2 text-[10px] font-medium text-gray-400">
          Powered by Stripe
        </div>
      )}
      <div className="pt-5">
        {loading ? (skeleton ?? <DefaultSkeleton />) : children}
      </div>
    </div>
  );
}

function DefaultSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      <div className="grid grid-cols-4 gap-3 border-b border-gray-100 pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-3 animate-pulse rounded bg-gray-200" />
        ))}
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="grid grid-cols-4 gap-3 py-1">
          <div className="h-4 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200 justify-self-end" />
        </div>
      ))}
    </div>
  );
}
