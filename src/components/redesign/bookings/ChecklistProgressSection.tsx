'use client';

import { Check } from 'lucide-react';
import { Collapsible } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { checklistProgressLabel } from '@/components/redesign/cleaner/job/active-job-presenters';
import { progressPercent } from '@/components/redesign/homeowner/home/job-progress-presenters';
import { useJobChecklistProgress } from '@/hooks/useJobChecklistProgress';
import { cn } from '@/lib/utils';
import type { BookingStatusKey } from './bookings-types';

/**
 * Read-only, live view of the cleaner's checklist for the operator's booking
 * detail sheet. Ticks arrive in realtime via the shared job-progress hook, so
 * the office watches the same state the cleaner and homeowner see. Shown only
 * once a job is running (or done); bookings without a checklist render nothing.
 */
export function ChecklistProgressSection({
  appointmentId,
  status,
  checklistId,
  serviceTypeId,
}: {
  appointmentId: string;
  status: BookingStatusKey;
  checklistId: string | null;
  serviceTypeId: string | null;
}) {
  const { lineItems, completed, doneCount, totalCount, isLoading } = useJobChecklistProgress({
    appointmentId,
    checklistId,
    serviceTypeId,
  });

  if (status !== 'in_progress' && status !== 'completed') return null;
  if (!isLoading && totalCount === 0) return null;

  return (
    <>
      <Separator />
      <Collapsible
        title="Checklist"
        right={
          totalCount > 0 ? (
            <span className="font-normal normal-case tracking-normal">
              {doneCount} of {totalCount}
            </span>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-2 w-full rounded-control" />
            <Skeleton className="h-4 w-3/4 rounded-control" />
            <Skeleton className="h-4 w-2/3 rounded-control" />
          </div>
        ) : (
          <div className="space-y-3">
            {status === 'in_progress' && (
              <Progress
                value={progressPercent(doneCount, totalCount)}
                aria-label={checklistProgressLabel(doneCount, totalCount)}
                className="h-1.5"
              />
            )}
            <ul role="list" className="space-y-1.5">
              {lineItems.map((item) => {
                const done = completed.has(item.id);
                return (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border',
                        done ? 'border-success-600' : 'border-border',
                      )}
                      aria-hidden
                    >
                      {done && <Check className="size-3 text-success-600" />}
                    </span>
                    <span
                      className={cn(
                        'leading-snug',
                        done ? 'text-muted-foreground line-through' : 'text-foreground',
                      )}
                    >
                      {item.task}
                    </span>
                    {done && <span className="sr-only">(done)</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Collapsible>
    </>
  );
}
