'use client';

import { useMemo, useState } from 'react';
import {
  Building2,
  ChevronRight,
  CreditCard,
  Loader,
  RefreshCw,
  Users,
} from 'lucide-react';
import { usePlatformOrganizations } from '@/hooks/usePlatformOrganizations';
import type { PlatformOrgSummary } from '@/types/platform';
import { PaymentsBadge, SubscriptionBadge } from './statusBadges';
import { PlatformOrgDetail } from './PlatformOrgDetail';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function StatCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: number;
  Icon: typeof Building2;
}) {
  return (
    <div className="rounded-xl border border-secondary-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-secondary-500">{label}</span>
        <Icon className="h-5 w-5 text-secondary-400" aria-hidden="true" />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-secondary-900">{value}</p>
    </div>
  );
}

export function PlatformOverviewPage() {
  const { data: organizations, isLoading, isError, error, refetch, isFetching } =
    usePlatformOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const orgs = organizations ?? [];
    return {
      total: orgs.length,
      active: orgs.filter((o) => o.subscription_status === 'active').length,
      trialing: orgs.filter((o) => o.subscription_status === 'trialing').length,
      paymentsReady: orgs.filter(
        (o) => o.stripe_connect_charges_enabled && o.stripe_connect_payouts_enabled,
      ).length,
    };
  }, [organizations]);

  if (selectedOrgId) {
    return <PlatformOrgDetail orgId={selectedOrgId} onBack={() => setSelectedOrgId(null)} />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Platform Owner</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Every cleaning company on Nexxus, and how they’re doing.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 rounded-lg border border-secondary-200 bg-white px-3 py-2 text-sm font-medium text-secondary-700 transition-colors duration-200 hover:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </header>

      {/* KPI summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Tenants" value={stats.total} Icon={Building2} />
        <StatCard label="Active plans" value={stats.active} Icon={CreditCard} />
        <StatCard label="On trial" value={stats.trialing} Icon={Users} />
        <StatCard label="Payments ready" value={stats.paymentsReady} Icon={CreditCard} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-secondary-200 bg-white py-16">
          <Loader className="h-6 w-6 animate-spin text-secondary-400" aria-label="Loading tenants" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">
            Couldn’t load tenants{error instanceof Error ? `: ${error.message}` : ''}.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : (organizations?.length ?? 0) === 0 ? (
        <div className="rounded-xl border border-dashed border-secondary-300 bg-white p-12 text-center">
          <Building2 className="mx-auto h-10 w-10 text-secondary-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-secondary-900">No tenants yet</p>
          <p className="mt-1 text-sm text-secondary-500">
            Provision your first cleaning company to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-secondary-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-secondary-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                <th scope="col" className="px-4 py-3">Organization</th>
                <th scope="col" className="px-4 py-3">Subscription</th>
                <th scope="col" className="px-4 py-3">Payments</th>
                <th scope="col" className="px-4 py-3 text-right">Members</th>
                <th scope="col" className="px-4 py-3">Created</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">View</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {(organizations ?? []).map((org: PlatformOrgSummary) => (
                <tr
                  key={org.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`View ${org.name}`}
                  onClick={() => setSelectedOrgId(org.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedOrgId(org.id);
                    }
                  }}
                  className="cursor-pointer transition-colors duration-150 hover:bg-secondary-50 focus:bg-secondary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-secondary-900">{org.name}</div>
                    {org.billing_email && (
                      <div className="text-xs text-secondary-500">{org.billing_email}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <SubscriptionBadge status={org.subscription_status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <PaymentsBadge org={org} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-secondary-700">
                    {org.member_counts.total}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-secondary-500">
                    {formatDate(org.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="ml-auto h-4 w-4 text-secondary-400" aria-hidden="true" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
