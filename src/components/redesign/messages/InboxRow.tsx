'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { UnreadBadge } from './messages-pills';

/**
 * The one inbox-row shell (D1): flush bordered list row with a leading
 * avatar/icon slot, name line (pill + time), preview line (accessory + unread
 * pill), and an optional third line. Carries the hit-area/a11y baseline (D15):
 * touch-manipulation, focus ring, 44px minimum, sr-only unread count.
 *
 * Pass `active` (true/false) on surfaces where the row is a selection toggle
 * (the operator two-pane inbox): it renders aria-pressed + the left rail.
 * Omit it on navigation rows (cleaner/homeowner takeovers).
 */
export function InboxRow({
  leading,
  name,
  namePill,
  timeLabel,
  preview,
  previewMuted = false,
  previewAccessory,
  unreadCount = 0,
  thirdLine,
  trailing,
  active,
  onSelect,
}: {
  leading: React.ReactNode;
  name: string;
  namePill?: React.ReactNode;
  timeLabel?: string;
  preview: string;
  /** Force muted preview styling regardless of unread (closed/past rows). */
  previewMuted?: boolean;
  previewAccessory?: React.ReactNode;
  unreadCount?: number;
  thirdLine?: React.ReactNode;
  trailing?: React.ReactNode;
  active?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'relative flex min-h-[44px] w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left',
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
      {leading}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[15px] font-bold leading-tight">{name}</span>
          {namePill}
          {timeLabel ? (
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {timeLabel}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px]',
              !previewMuted && unreadCount > 0
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {preview}
          </span>
          {previewAccessory}
          {!previewMuted && <UnreadBadge count={unreadCount} />}
        </span>
        {thirdLine}
      </span>
      {trailing}
    </button>
  );
}

/** The one inbox-row skeleton (D9): size-11 avatar + two text lines, matching the real row's box. */
export function InboxRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
      <Skeleton className="size-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
