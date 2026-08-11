'use client';

import { cn } from '@/lib/utils';
import { UnreadBadge } from './messages-pills';
import type { JobThreadRowVM } from './jobThreadRow';

/**
 * Read-only job-thread row for the operator console inbox (homeowner<->cleaner
 * thread). No delete affordance and no composer: the office views these threads
 * but never posts into them. Selection follows the office rows' idiom (D4):
 * aria-pressed + left rail + bg-accent.
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
      aria-pressed={active}
      className={cn(
        'relative flex min-h-[44px] w-full flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-left',
        'touch-manipulation outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        'active:bg-accent hover:bg-accent/60',
        active && 'bg-accent',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-primary"
        />
      )}
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{row.title}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">{row.timeLabel}</span>
          <UnreadBadge count={row.unreadCount} />
        </span>
      </span>
      <span className="flex items-center gap-2">
        {row.dateLabel && (
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
            {row.dateLabel}
          </span>
        )}
        <span className="truncate text-xs text-muted-foreground">{row.preview}</span>
      </span>
    </button>
  );
}
