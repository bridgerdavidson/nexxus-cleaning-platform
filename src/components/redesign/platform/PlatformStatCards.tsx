'use client';

import {
  Building2,
  CreditCard,
  Clock,
  CheckCircle2,
  Landmark,
  TrendingUp,
  CalendarCheck,
  UserPlus,
} from 'lucide-react';
import { StatTile } from '@/components/ui/stat-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { usePlatformStats } from '@/hooks/usePlatformStats';
import { formatCents } from '@/lib/platform/presenters';

function StatSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-[108px] rounded-card" />
      ))}
    </div>
  );
}

/** The 8 platform overview KPIs. Money tiles format cents to USD; counts render as-is. */
export function PlatformStatCards() {
  const { data, isLoading, isError, refetch } = usePlatformStats();

  if (isError) {
    return <ErrorState title="Couldn't load platform metrics" onRetry={() => refetch()} />;
  }
  if (isLoading || !data) return <StatSkeletons />;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Tenants" value={String(data.tenants)} icon={<Building2 />} />
      <StatTile label="Active plans" value={String(data.active_plans)} icon={<CreditCard />} />
      <StatTile label="On trial" value={String(data.trialing)} icon={<Clock />} />
      <StatTile label="Payments ready" value={String(data.payments_ready)} icon={<CheckCircle2 />} />
      <StatTile label="Platform fees" value={formatCents(data.platform_fees_cents)} icon={<Landmark />} />
      <StatTile label="GMV" value={formatCents(data.gmv_cents)} icon={<TrendingUp />} />
      <StatTile label="Appointments" value={String(data.total_appointments)} icon={<CalendarCheck />} />
      <StatTile label="New tenants 30d" value={String(data.new_tenants_30d)} icon={<UserPlus />} />
    </div>
  );
}
