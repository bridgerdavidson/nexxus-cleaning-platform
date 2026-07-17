'use client';

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { usePlatformAlerts, useResolvePlatformAlert } from '@/hooks/usePlatformAlerts';
import { alertSeverityMeta } from '@/lib/platform/presenters';
import type { PlatformAlert } from '@/types/platform';

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
];

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  if (!entries.length) return '';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

function ResolveButton({ alert }: { alert: PlatformAlert }) {
  const resolve = useResolvePlatformAlert();
  const isResolved = alert.resolved_at != null;
  const pending = resolve.isPending && resolve.variables?.id === alert.id;

  return (
    <Button
      variant={isResolved ? 'ghost' : 'secondary'}
      size="sm"
      loading={pending}
      onClick={() =>
        resolve.mutate(
          { id: alert.id, resolved: !isResolved },
          {
            onSuccess: () => toast.success(isResolved ? 'Alert reopened' : 'Alert resolved'),
            onError: (err) =>
              toast.error('Could not update the alert', {
                description: err instanceof Error ? err.message : undefined,
              }),
          },
        )
      }
    >
      {isResolved ? 'Reopen' : 'Resolve'}
    </Button>
  );
}

function Occurrences({ alert }: { alert: PlatformAlert }) {
  if ((alert.occurrences ?? 1) <= 1) return <span className="text-muted-foreground">-</span>;
  return (
    <span
      className="tabular-nums text-muted-foreground"
      title={`First seen ${formatWhen(alert.first_seen_at)}`}
    >
      &times;{alert.occurrences}
    </span>
  );
}

/** Platform-owner operational alert outbox: filterable, paginated, resolvable. */
export function PlatformAlerts() {
  const [status, setStatus] = useState('open');
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    usePlatformAlerts({ status, limit: 50 });

  const alerts = data?.pages.flatMap((p) => p.alerts) ?? [];

  return (
    <div className="max-w-[1700px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Alerts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Money-movement failures and reconciler findings only the platform owner can act on.
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {isError ? (
        <ErrorState title="Couldn't load alerts" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-card" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<BellRing />}
          title={status === 'open' ? 'All clear' : 'No alerts match this filter'}
          description={
            status === 'open'
              ? 'No open money-movement alerts. Reconciler findings and failed transfers will appear here.'
              : 'Try a different status.'
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-card border border-border bg-card shadow-soft-sm lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Severity</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Seen</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => {
                  const meta = alertSeverityMeta(a.severity);
                  const details = formatDetails(a.details);
                  return (
                    <TableRow key={a.id} className="hover:bg-transparent">
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[34rem]">
                        <div className="text-sm text-foreground">{a.summary}</div>
                        {details ? (
                          <div className="truncate text-xs text-muted-foreground" title={details}>
                            {details}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatWhen(a.last_seen_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Occurrences alert={a} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ResolveButton alert={a} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {alerts.map((a) => {
              const meta = alertSeverityMeta(a.severity);
              const details = formatDetails(a.details);
              return (
                <div key={a.id} className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatWhen(a.last_seen_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{a.summary}</p>
                  {details ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={details}>
                      {details}
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between">
                    <Occurrences alert={a} />
                    <ResolveButton alert={a} />
                  </div>
                </div>
              );
            })}
          </div>

          {hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void fetchNextPage()}
                loading={isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
