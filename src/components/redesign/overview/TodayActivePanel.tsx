import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActiveItem, ScheduleItem } from "./overview-types";

export function TodayActivePanel({
  today,
  activeNow,
  loading,
}: {
  today: ScheduleItem[];
  activeNow: ActiveItem[];
  loading?: boolean;
}) {
  return (
    <div className="space-y-4 lg:space-y-5">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-bold tracking-tight">Today&apos;s schedule</h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : today.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled today.</p>
          ) : (
            today.map((it) => (
              <div key={it.id} className="flex items-center gap-3 border-b border-border/60 py-2 last:border-0">
                <span className="w-16 flex-none text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-300">{it.time}</span>
                <span className="truncate text-sm text-foreground">{it.title}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <LiveDot pulse={activeNow.length > 0} />
          <h2 className="text-xl font-bold tracking-tight">Active now</h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-6 w-2/3" />
          ) : activeNow.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs in progress.</p>
          ) : (
            activeNow.map((it) => (
              <div key={it.id} className="flex items-center gap-3 py-2">
                <LiveDot />
                <span className="truncate text-sm text-foreground">{it.title}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Single pulsing "live" cue on the section header (pulse); rows get a static
// solid dot. Keeps infinite motion to one element per the motion guidelines.
function LiveDot({ pulse = false }: { pulse?: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 flex-none" aria-hidden>
      {pulse ? (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive-700 opacity-60 motion-reduce:hidden" />
      ) : null}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-positive-700" />
    </span>
  );
}
