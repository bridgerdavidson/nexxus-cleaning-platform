import { Loader2, MessageSquare } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** The one in-thread loading skeleton (D9): alternating bubble bars. */
export function ThreadSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className={cn('h-10 rounded-card', i % 2 ? 'ml-auto w-2/3' : 'w-1/2')} />
      ))}
    </div>
  );
}

/** The one compact in-thread empty state (D8): size-6 icon + title + optional body. */
export function ThreadEmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <MessageSquare className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {body ? <p className="max-w-xs text-xs text-muted-foreground">{body}</p> : null}
    </div>
  );
}

/** The one load-more indicator (D9): Loader2 size-4 in every paging list. */
export function LoadMoreSpinner() {
  return (
    <div className="flex justify-center py-1">
      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
    </div>
  );
}
