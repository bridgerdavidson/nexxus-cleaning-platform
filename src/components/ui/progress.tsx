import * as React from 'react';
import { cn } from '@/lib/utils';

export function Progress({
  value,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  className?: string;
  'aria-label'?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn('h-2 w-full overflow-hidden rounded-pill bg-muted', className)}
    >
      <div
        className="h-full rounded-pill bg-brand-600 transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
