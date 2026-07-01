'use client';

import { cn } from '@/lib/utils';
import type { JobThreadRowVM } from './jobThreadRow';

/**
 * Read-only job-thread row for the operator console inbox (homeowner<->cleaner
 * thread). No delete affordance and no composer: the office views these threads
 * but never posts into them.
 */
export function JobThreadInboxRow({
  row,
  active,
  onSelect,
}: {
  row: JobThreadRowVM;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-0.5 border-l-2 px-4 py-3 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{row.title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{row.timeLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        {row.dateLabel && (
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
            {row.dateLabel}
          </span>
        )}
        <span className="truncate text-xs text-muted-foreground">{row.preview}</span>
      </div>
    </button>
  );
}
