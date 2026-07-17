import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TodayItem } from "./overview-types";

/**
 * Unified "Today" dispatch card: one time-sorted list of today's jobs plus any
 * still-running job from a previous day. Live state is carried by the badge
 * vocabulary (static dot, elapsed time) and a soft row tint — no infinite
 * motion. Rows use the same row-card idiom as NeedsYouNowQueue so the whole
 * Overview speaks one visual language.
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
          {liveCount > 0 && (
            <Badge variant="positive">
              <span aria-hidden className="size-1.5 rounded-pill bg-positive-700" />
              {liveCount} live
            </Badge>
          )}
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
        live
          ? "border-positive/30 bg-positive-50 dark:border-positive/25 dark:bg-positive/10"
          : "border-border bg-card",
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
      </div>
      <StatusPill item={item} />
    </Root>
  );
}

function StatusPill({ item }: { item: TodayItem }) {
  switch (item.status) {
    case "live":
      return (
        <Badge variant="positive" className="flex-none">
          <span aria-hidden className="size-1.5 rounded-pill bg-positive-700" />
          {item.elapsed ? `Live · ${item.elapsed}` : "Live"}
        </Badge>
      );
    case "done":
      return (
        <Badge variant="secondary" className="flex-none">
          Done
        </Badge>
      );
    case "unassigned":
      return (
        <Badge variant="caution" className="flex-none">
          Unassigned
        </Badge>
      );
    default:
      return null;
  }
}
