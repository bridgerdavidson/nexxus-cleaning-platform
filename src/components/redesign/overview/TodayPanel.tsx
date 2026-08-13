"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingStatusBadge } from "@/components/redesign/bookings/bookings-presenters";
import { checklistProgressLabel } from "@/components/redesign/cleaner/job/active-job-presenters";
import { progressPercent } from "@/components/redesign/homeowner/home/job-progress-presenters";
import { useJobChecklistProgress } from "@/hooks/useJobChecklistProgress";
import { cn } from "@/lib/utils";
import type { TodayItem } from "./overview-types";

/**
 * Unified "Today" dispatch card: one time-sorted list of today's jobs plus any
 * still-running job from a previous day. Status rendering reuses the Bookings
 * badge vocabulary (blue = in progress, green = done, amber = unassigned) so
 * the card can't drift from the app-wide status colors; live rows add a soft
 * primary row tint. Rows use the same row-card idiom as NeedsYouNowQueue so
 * the whole Overview speaks one visual language.
 */
export function TodayPanel({
  items,
  loading,
  onOpenBooking,
}: {
  items: TodayItem[];
  loading?: boolean;
  /** Opens a booking's detail sheet. Withheld (undefined) for viewers without
   *  can_view_bookings; rows then render informational-only. */
  onOpenBooking?: (appointmentId: string) => void;
}) {
  const liveCount = items.filter((i) => i.status === "live").length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <h2 className="text-xl font-bold tracking-tight">Today</h2>
        <div className="flex items-center gap-2">
          {liveCount > 0 && <Badge variant="default">{liveCount} live</Badge>}
          <Badge variant="secondary">
            {items.length} {items.length === 1 ? "job" : "jobs"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="max-h-[600px] space-y-2 overflow-y-auto">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-control" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled today.</p>
        ) : (
          items.map((it) => <TodayRow key={it.id} item={it} onOpenBooking={onOpenBooking} />)
        )}
      </CardContent>
    </Card>
  );
}

function TodayRow({
  item,
  onOpenBooking,
}: {
  item: TodayItem;
  onOpenBooking?: (appointmentId: string) => void;
}) {
  const live = item.status === "live";
  // The row itself is the single interactive control (a plain button), so
  // there's no nested-interactive concern like the queue's row+action pair.
  const Root: "button" | "div" = onOpenBooking ? "button" : "div";

  return (
    <Root
      {...(onOpenBooking
        ? { type: "button" as const, onClick: () => onOpenBooking(item.id) }
        : {})}
      className={cn(
        "flex w-full items-center gap-3 rounded-control border p-3 text-left transition-colors duration-200",
        live ? "border-primary/30 bg-primary/5 dark:bg-primary/10" : "border-border bg-card",
        item.status === "done" && "opacity-60",
        onOpenBooking &&
          "cursor-pointer hover:border-brand-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        onOpenBooking && !live && "hover:bg-muted/40"
      )}
    >
      <span className="w-14 flex-none text-sm font-semibold text-foreground tnum">{item.time}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
        {live && (
          <LiveRowProgress
            appointmentId={item.id}
            checklistId={item.checklistId ?? null}
            serviceTypeId={item.serviceTypeId ?? null}
          />
        )}
      </div>
      <StatusPill item={item} />
    </Root>
  );
}

/** Live task progress under a running row's title: thin bar + "N of M done",
 *  fed by the same realtime subscription the homeowner's live card uses. The
 *  marketing site promises the office this exact row. Renders nothing until
 *  the checklist resolves (jobs without checklists keep the plain row). */
function LiveRowProgress({
  appointmentId,
  checklistId,
  serviceTypeId,
}: {
  appointmentId: string;
  checklistId: string | null;
  serviceTypeId: string | null;
}) {
  const { doneCount, totalCount } = useJobChecklistProgress({
    appointmentId,
    checklistId,
    serviceTypeId,
  });
  if (totalCount === 0) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <Progress
        value={progressPercent(doneCount, totalCount)}
        aria-label={checklistProgressLabel(doneCount, totalCount)}
        className="h-1.5 flex-1"
      />
      <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
        {doneCount}/{totalCount} done
      </span>
    </div>
  );
}

function StatusPill({ item }: { item: TodayItem }) {
  switch (item.status) {
    case "live":
      // Same pill as Bookings' "In progress" (blue + motion-safe spinner),
      // with the elapsed time as the text when we know it.
      return item.elapsed ? (
        <Badge variant="default" className="shrink-0 whitespace-nowrap">
          <Loader2 className="motion-safe:animate-spin" />
          {item.elapsed}
        </Badge>
      ) : (
        <BookingStatusBadge badge="in_progress" />
      );
    case "done":
      return <BookingStatusBadge badge="completed" />;
    case "unassigned":
      return <BookingStatusBadge badge="unassigned" />;
    default:
      return null;
  }
}
