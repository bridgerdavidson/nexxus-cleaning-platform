'use client';

/**
 * CleanerChecklistView
 *
 * Full-screen sub-screen BODY for reviewing and completing checklist tasks on
 * an active job. Rendered inside the CleanerJobDetailOverlay takeover by the
 * Task-10 container — no separate overlay chrome.
 *
 * Completion state is persisted to the DB via useToggleChecklistItem (optimistic
 * upsert/delete on checklist_item_completions). The Checkbox primitive from
 * src/components/ui/checkbox.tsx is used for each row.
 */

import React, { useCallback } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  useChecklist,
  useChecklistCompletions,
  useToggleChecklistItem,
} from '@/hooks/useCleanerData';
import { checklistProgressLabel } from './active-job-presenters';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CleanerChecklistViewProps {
  appointmentId: string;
  /** Preferred checklist id (from appointment.checklist_id). May be null for
   *  legacy rows — in that case `serviceTypeId` is used as a fallback (the first
   *  checklist for that service type); if neither resolves, an empty state shows. */
  checklistId: string | null;
  /** Fallback when `checklistId` is null (legacy rows): resolve the service
   *  type's first checklist. From appointment.service_type_id. */
  serviceTypeId?: string | null;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CleanerChecklistView({
  appointmentId,
  checklistId,
  serviceTypeId = null,
  onBack,
}: CleanerChecklistViewProps) {
  const { lineItems, loading: checklistLoading } = useChecklist({
    checklistId,
    serviceTypeId,
  });
  const { completed, isLoading: completionsLoading } = useChecklistCompletions(appointmentId);
  const toggle = useToggleChecklistItem();

  const isLoading = checklistLoading || completionsLoading;

  const handleToggle = useCallback(
    (lineItemId: string, currentlyDone: boolean) => {
      toggle.mutate({ appointmentId, lineItemId, done: !currentlyDone });
    },
    [appointmentId, toggle],
  );

  const doneCount = lineItems.reduce(
    (acc, item) => (completed.has(item.id) ? acc + 1 : acc),
    0,
  );

  const progressLabel = checklistProgressLabel(doneCount, lineItems.length);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* ---- Header ---- */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <IconButton aria-label="Back" variant="ghost" onClick={onBack}>
          <ChevronLeft />
        </IconButton>
        <h2 className="flex-1 text-center text-base font-bold text-foreground">
          {progressLabel}
        </h2>
        {/* Spacer mirrors icon-button width so title centres */}
        <div className="h-11 w-11" aria-hidden />
      </div>

      {/* ---- Scrollable body ---- */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-2">
        {isLoading ? (
          <LoadingSkeleton />
        ) : lineItems.length === 0 ? (
          <EmptyState />
        ) : (
          <ul role="list" className="divide-y divide-border">
            {lineItems.map((item) => {
              const done = completed.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex min-h-[48px] w-full items-center gap-3 py-1 text-left',
                      'transition-colors duration-base',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    )}
                    onClick={() => handleToggle(item.id, done)}
                    aria-pressed={done}
                  >
                    <Checkbox
                      checked={done}
                      onCheckedChange={() => handleToggle(item.id, done)}
                      aria-hidden
                      tabIndex={-1}
                      className="pointer-events-none shrink-0"
                    />
                    <span
                      className={cn(
                        'flex-1 text-sm font-medium leading-snug',
                        done
                          ? 'text-muted-foreground line-through'
                          : 'text-foreground',
                      )}
                    >
                      {item.task}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---- Done bar (mirrors the overview's persistent Complete bar) ---- */}
      {!isLoading && lineItems.length > 0 && (
        <div
          className="border-t border-border bg-card px-4 pt-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        >
          <div className="mx-auto w-full max-w-lg">
            <Button
              size="lg"
              className="w-full"
              disabled={doneCount < lineItems.length}
              onClick={onBack}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <ul role="list" aria-label="Loading checklist" className="divide-y divide-border">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex min-h-[48px] items-center gap-3 py-1">
          <Skeleton className="size-6 rounded-chip shrink-0" />
          <Skeleton className="h-4 flex-1 rounded-control" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <p className="mt-8 text-center text-sm text-muted-foreground">
      No checklist for this job
    </p>
  );
}
