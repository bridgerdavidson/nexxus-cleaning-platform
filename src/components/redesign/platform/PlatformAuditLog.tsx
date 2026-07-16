'use client';

import { useState } from 'react';
import { ScrollText } from 'lucide-react';
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
import { usePlatformAudit } from '@/hooks/usePlatformAudit';
import { auditActionMeta } from '@/lib/platform/presenters';
import type { PlatformAuditEntry } from '@/types/platform';
import { useOpenTenant } from './useOpenTenant';

const ACTION_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All actions' },
  { id: 'impersonation_start', label: 'Viewed as company' },
  { id: 'impersonation_end', label: 'Ended view-as' },
  { id: 'provision_tenant', label: 'Provisioned tenant' },
  { id: 'reset_tenant_connect', label: 'Reset tenant Connect' },
  { id: 'reset_cleaner_connect', label: 'Reset cleaner Connect' },
  { id: 'delete_tenant', label: 'Deleted tenant' },
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

function formatMeta(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta ?? {});
  if (!entries.length) return '';
  return entries
    .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

function TenantCell({
  entry,
  onOpen,
}: {
  entry: PlatformAuditEntry;
  onOpen: (id: string) => void;
}) {
  if (!entry.target_org_id) {
    return <span className="text-muted-foreground">{entry.target_org_name ?? '-'}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.target_org_id as string)}
      className="text-left font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {entry.target_org_name ?? 'View tenant'}
    </button>
  );
}

/** Global platform audit log: filterable, paginated table over platform_audit_log. */
export function PlatformAuditLog() {
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    usePlatformAudit({ limit: 50 });
  const { open } = useOpenTenant();
  const [action, setAction] = useState('all');

  const all = data?.pages.flatMap((p) => p.entries) ?? [];
  const entries = action === 'all' ? all : all.filter((e) => e.action === action);

  return (
    <div className="max-w-[1700px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Impersonations, provisions, deletes, and Connect resets.
          </p>
        </div>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-52" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_FILTERS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {isError ? (
        <ErrorState title="Couldn't load the audit log" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-card" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={all.length === 0 ? 'No activity recorded yet.' : 'No entries match this filter'}
          description={
            all.length === 0
              ? 'Platform actions (impersonations, provisions, deletes, resets) will appear here.'
              : 'Try a different action, or load more entries.'
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-card border border-border bg-card shadow-soft-sm lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const meta = auditActionMeta(e.action);
                  const details = formatMeta(e.metadata);
                  return (
                    <TableRow key={e.id} className="hover:bg-transparent">
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatWhen(e.started_at)}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">{e.actor_name}</TableCell>
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <TenantCell entry={e} onOpen={open} />
                      </TableCell>
                      <TableCell className="max-w-[20rem] truncate text-xs text-muted-foreground" title={details}>
                        {details || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {entries.map((e) => {
              const meta = auditActionMeta(e.action);
              const details = formatMeta(e.metadata);
              return (
                <div key={e.id} className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatWhen(e.started_at)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="text-foreground">{e.actor_name}</span>
                    <TenantCell entry={e} onOpen={open} />
                  </div>
                  {details ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={details}>
                      {details}
                    </p>
                  ) : null}
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
