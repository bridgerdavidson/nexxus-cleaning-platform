import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import type { QueueItem } from "./overview-types";

type Group = {
  kind: string;
  label: string;
  actionLabel: string;
  tone: "caution" | "critical" | "info";
  items: QueueItem[];
};

export function NeedsYouNowQueue({
  unassigned,
  declined,
  counterProposed,
  loading,
}: {
  unassigned: QueueItem[];
  declined: QueueItem[];
  counterProposed: QueueItem[];
  loading?: boolean;
}) {
  const groups: Group[] = [
    { kind: "unassigned", label: "Unassigned", actionLabel: "Assign", tone: "caution", items: unassigned },
    { kind: "declined", label: "All cleaners declined", actionLabel: "Force-assign", tone: "critical", items: declined },
    { kind: "counter", label: "Counter-proposed", actionLabel: "Review", tone: "info", items: counterProposed },
  ];
  const total = unassigned.length + declined.length + counterProposed.length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <h2 className="text-xl font-bold tracking-tight">Needs you now</h2>
        {total > 0 ? <Badge variant="secondary">{total > 99 ? "99+" : total}</Badge> : null}
      </CardHeader>
      <CardContent className="max-h-[600px] space-y-5 overflow-y-auto">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-control" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={<CheckCircle2 />}
            title="You're all caught up"
            description="No bookings need your attention right now."
          />
        ) : (
          groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.kind}>
                <h3 className="sr-only">{g.label}</h3>
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant={g.tone}>{g.label}</Badge>
                  <Badge variant="secondary">{g.items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {g.items.map((it) => (
                    <div
                      key={it.id}
                      className="group flex cursor-pointer items-center gap-3 rounded-control border border-border bg-card p-3 transition-colors duration-200 hover:border-brand-600/40 hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{it.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{it.subtitle}</p>
                      </div>
                      <Button size="sm" variant={g.kind === "counter" ? "secondary" : "default"}>
                        {g.actionLabel}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
        )}
      </CardContent>
    </Card>
  );
}
