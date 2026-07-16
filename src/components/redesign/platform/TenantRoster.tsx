'use client';

import { useMemo, useState } from 'react';
import { Building2, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { ListFilterBar } from '@/components/redesign/shared/ListFilterBar';
import { usePlatformOrganizations } from '@/hooks/usePlatformOrganizations';
import type { PlatformOrgSummary } from '@/types/platform';
import { SubscriptionPill, PaymentsPill } from './pills';
import { useOpenTenant } from './useOpenTenant';

type SubFilterId = 'all' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
const SUB_FILTERS: { id: SubFilterId; label: string; match: (status: string) => boolean }[] = [
  { id: 'all', label: 'All plans', match: () => true },
  { id: 'active', label: 'Active', match: (s) => s === 'active' },
  { id: 'trialing', label: 'Trial', match: (s) => s === 'trialing' },
  { id: 'past_due', label: 'Past due', match: (s) => s === 'past_due' },
  { id: 'canceled', label: 'Canceled', match: (s) => s === 'canceled' || s === 'cancelled' },
  {
    id: 'none',
    label: 'No plan',
    match: (s) => !['active', 'trialing', 'past_due', 'canceled', 'cancelled'].includes(s),
  },
];

type SortKey = 'name' | 'members' | 'created';
interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '-';
  }
}

function sortRows(rows: PlatformOrgSummary[], sort: SortState): PlatformOrgSummary[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'name') cmp = a.name.localeCompare(b.name);
    else if (sort.key === 'members') cmp = a.member_counts.total - b.member_counts.total;
    else cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return cmp * dir;
  });
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}

function RosterSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-card border border-border bg-card p-4 shadow-soft-sm"
        >
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="hidden h-7 w-20 sm:block" />
          <Skeleton className="hidden h-7 w-20 lg:block" />
          <Skeleton className="hidden h-7 w-10 lg:block" />
        </div>
      ))}
    </div>
  );
}

/** Tenant roster: search + plan filter + sortable columns over the tenant list. */
export function TenantRoster() {
  const { data: organizations = [], isLoading, isError, refetch } = usePlatformOrganizations();
  const { open } = useOpenTenant();

  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState<SubFilterId>('all');
  const [sort, setSort] = useState<SortState>({ key: 'created', dir: 'desc' });

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matcher = SUB_FILTERS.find((f) => f.id === subFilter) ?? SUB_FILTERS[0];
    const rows = organizations.filter((o) => {
      const matchesSearch =
        !q ||
        o.name.toLowerCase().includes(q) ||
        (o.billing_email?.toLowerCase().includes(q) ?? false);
      return matchesSearch && matcher.match(o.subscription_status);
    });
    return sortRows(rows, sort);
  }, [organizations, search, subFilter, sort]);

  // Cap the rendered rows so a very large tenant list degrades gracefully (the
  // list route itself is PostgREST-capped at 1000). Realistic counts render in
  // full; overflow prompts a search rather than silently truncating.
  const DISPLAY_CAP = 200;
  const capped = filtered.slice(0, DISPLAY_CAP);
  const overflow = filtered.length - capped.length;

  const filtersActive = !!search || subFilter !== 'all';
  const countLabel = isLoading
    ? 'Loading tenants...'
    : organizations.length === 0
      ? 'No tenants yet'
      : filtersActive
        ? `Showing ${filtered.length} of ${organizations.length}`
        : `${organizations.length} ${organizations.length === 1 ? 'tenant' : 'tenants'}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{countLabel}</p>

      <ListFilterBar
        search={
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or billing email"
              className="pl-10"
              aria-label="Search tenants"
            />
          </div>
        }
      >
        <Select value={subFilter} onValueChange={(v) => setSubFilter(v as SubFilterId)}>
          <SelectTrigger className="w-44" aria-label="Filter by plan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUB_FILTERS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ListFilterBar>

      {isError ? (
        <ErrorState title="Couldn't load tenants" onRetry={() => refetch()} />
      ) : isLoading ? (
        <RosterSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={organizations.length === 0 ? 'No tenants yet.' : 'No tenants match your filters'}
          description={
            organizations.length === 0
              ? 'Provision your first cleaning company to get started.'
              : 'Try a different search, or clear the filters.'
          }
          action={
            filtersActive ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setSubFilter('all');
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-card border border-border bg-card shadow-soft-sm lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortHeader label="Organization" sortKey="name" sort={sort} onSort={toggleSort} />
                  <TableHead>Subscription</TableHead>
                  <TableHead>Payments</TableHead>
                  <SortHeader
                    label="Members"
                    sortKey="members"
                    sort={sort}
                    onSort={toggleSort}
                    className="text-right"
                  />
                  <SortHeader label="Created" sortKey="created" sort={sort} onSort={toggleSort} />
                  <TableHead className="w-12 text-right" aria-label="View" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {capped.map((org) => (
                  <TableRow
                    key={org.id}
                    onClick={() => open(org.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="max-w-[24rem]">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">{org.name}</div>
                        {org.billing_email ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {org.billing_email}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <SubscriptionPill status={org.subscription_status} />
                    </TableCell>
                    <TableCell>
                      <PaymentsPill org={org} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">
                      {org.member_counts.total}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(org.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((org) => (
              <div
                key={org.id}
                role="button"
                tabIndex={0}
                onClick={() => open(org.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open(org.id);
                  }
                }}
                className="rounded-card border border-border bg-card p-4 shadow-soft-sm transition-colors duration-200 hover:border-brand-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{org.name}</div>
                    {org.billing_email ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {org.billing_email}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {org.member_counts.total} members
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SubscriptionPill status={org.subscription_status} />
                  <PaymentsPill org={org} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(org.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {overflow > 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              Showing the first {DISPLAY_CAP}. Refine your search to narrow the list.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
