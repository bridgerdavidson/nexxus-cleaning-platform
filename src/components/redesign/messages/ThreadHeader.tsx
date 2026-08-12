'use client';

import { ArrowLeft } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The one thread header (D5): back slot + avatar slot + title/subtitle + actions.
 * Used by the operator thread panel, the read-only job pane, the cleaner/homeowner
 * takeover threads, and the hosts' loading fallbacks, so every thread opens under
 * identical chrome.
 */
export function ThreadHeader({
  onBack,
  backLabel,
  backAriaLabel,
  backHiddenOnDesktop = false,
  avatar,
  title,
  subtitle,
  actions,
}: {
  onBack?: () => void;
  /** Visible label next to the back arrow (e.g. "Back to job"). */
  backLabel?: string;
  /** Defaults to the visible backLabel, then "Back". */
  backAriaLabel?: string;
  /** Two-pane desktop layouts hide back at lg: (the inbox stays beside the thread). */
  backHiddenOnDesktop?: boolean;
  /** Omit for headers without an avatar (read-only transcripts). */
  avatar?: { url: string | null; initials: string };
  /** Omit while loading: a skeleton bar renders in the title slot. */
  title?: string;
  subtitle?: React.ReactNode;
  /** Trailing controls (e.g. the operator Details button + actions menu). */
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card px-3 py-2.5">
      {onBack &&
        (backLabel ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backAriaLabel ?? backLabel}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1 rounded-control px-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              backHiddenOnDesktop && 'lg:hidden',
            )}
          >
            <ArrowLeft className="size-5 shrink-0" />
            <span className="text-sm font-semibold">{backLabel}</span>
          </button>
        ) : (
          <IconButton
            aria-label={backAriaLabel ?? 'Back'}
            className={cn('h-9 w-9 shrink-0', backHiddenOnDesktop && 'lg:hidden')}
            onClick={onBack}
          >
            <ArrowLeft className="size-5" />
          </IconButton>
        ))}
      {avatar && (
        <Avatar className="size-9 shrink-0">
          {avatar.url ? <AvatarImage src={avatar.url} alt="" /> : null}
          <AvatarFallback>{avatar.initials}</AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0 flex-1">
        {title !== undefined ? (
          <div className="truncate text-sm font-bold text-foreground">{title}</div>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
        {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
      {actions}
    </div>
  );
}
