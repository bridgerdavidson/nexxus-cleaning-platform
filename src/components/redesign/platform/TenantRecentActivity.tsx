'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlatformAudit } from '@/hooks/usePlatformAudit';
import { auditActionMeta } from '@/lib/platform/presenters';

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** This tenant's last 10 platform-audit entries (impersonations, resets, etc.). */
export function TenantRecentActivity({ orgId }: { orgId: string }) {
  const { data, isLoading, isError } = usePlatformAudit({ orgId, limit: 10 });
  const entries = data?.pages[0]?.entries ?? [];

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-foreground">Recent activity</h3>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-control" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load recent activity.</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border">
          {entries.map((e) => {
            const meta = auditActionMeta(e.action);
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="truncate text-sm text-muted-foreground">{e.actor_name}</span>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatWhen(e.started_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
