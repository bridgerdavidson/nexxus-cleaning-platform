// src/components/redesign/bookings/routing/RoutingHistorySection.tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Collapsible } from '@/components/ui/collapsible';
import { ErrorState } from '@/components/ui/error-state';
import { Separator } from '@/components/ui/separator';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import { buildRoutingTimeline } from '@/lib/bookings/routingHistoryVm';
import { useRoutingLog } from '@/hooks/useRoutingLog';
import type { CleanerOption } from '../bookings-types';

/**
 * R10: the cleaner-assignment offer trail, oldest attempt first. View-only.
 * Hidden entirely for directly-assigned bookings (no routing rows) and while
 * loading, so the common direct-assign case never flashes a section.
 */
export function RoutingHistorySection({
  appointmentId,
  cleanerOptions,
}: {
  appointmentId: string;
  cleanerOptions: CleanerOption[];
}) {
  const { rows, loading, error, refetch } = useRoutingLog(appointmentId);

  if (loading) return null;
  if (!error && rows.length === 0) return null;

  const items = buildRoutingTimeline(
    rows,
    new Map(cleanerOptions.map((c) => [c.id, c.name])),
    new Date(),
  );

  return (
    <>
      <Separator />
      <Collapsible
        title="Routing history"
        right={
          rows.length > 0 ? (
            <span className="font-normal normal-case tracking-normal">{rows.length}</span>
          ) : undefined
        }
      >
        {error ? (
          <ErrorState
            title="Couldn't load routing history"
            description="Something went wrong loading the offer history. Please try again."
            onRetry={refetch}
          />
        ) : (
          <Timeline className="mt-1">
            {items.map((it) => (
              <TimelineItem key={it.id} current={it.current}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">{it.name}</span>
                  <Badge variant={it.badgeVariant}>{it.badgeLabel}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{it.metaLine}</div>
                {it.declineReason ? (
                  <div className="mt-1 text-sm text-muted-foreground">“{it.declineReason}”</div>
                ) : null}
              </TimelineItem>
            ))}
          </Timeline>
        )}
      </Collapsible>
    </>
  );
}
