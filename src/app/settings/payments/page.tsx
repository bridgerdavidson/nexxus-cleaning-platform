'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useTenantConnect } from '@/hooks/useTenantConnect';
import { sectionVisibleToRole } from '@/lib/settings';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import StripeStatusHero, {
  OpenStripeDashboardButton,
} from '@/components/settings/StripeStatusHero';
import StripeBalanceRow from '@/components/settings/StripeBalanceRow';
import TenantStripeConnect, {
  tenantStatusKind,
} from '@/components/TenantStripeConnect';

type TenantBalance = {
  connected: boolean;
  availableBalance: number;
  pendingBalance: number;
  latestPayout: { amount: number; date: number } | null;
};

export default function PaymentsSettingsPage() {
  const router = useRouter();
  const { user, currentOrganizationId, currentOrgRole, loading: authLoading } = useAuth();
  const { permissions } = useManagerPermissions();
  const { status, statusLoading, loading: connectLoading } = useTenantConnect();

  // Client-side role gate.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (
      !sectionVisibleToRole(
        'payments',
        user.role,
        currentOrgRole ?? undefined,
        permissions,
      )
    ) {
      router.replace('/settings');
    }
  }, [authLoading, user, currentOrgRole, permissions, router]);

  // Balance fetch (tenant) — only when connected.
  const [balance, setBalance] = useState<TenantBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  useEffect(() => {
    if (!currentOrganizationId || !status?.chargesEnabled) return;
    let cancelled = false;
    (async () => {
      setBalanceLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch('/api/stripe/tenant/balance-summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ organizationId: currentOrganizationId }),
        });
        const data = (await res.json().catch(() => null)) as TenantBalance | null;
        if (cancelled || !data) return;
        setBalance(data);
      } catch {
        // swallow — the embedded ConnectPayouts table below is still the source of truth
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId, status?.chargesEnabled]);

  const [dashboardLoading, setDashboardLoading] = useState(false);
  async function openStripeDashboard() {
    if (!currentOrganizationId || dashboardLoading) return;
    setDashboardLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch('/api/stripe/tenant/connect/login-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ organizationId: currentOrganizationId }),
      });
      const data = await res.json().catch(() => null);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } finally {
      setDashboardLoading(false);
    }
  }

  const kind = tenantStatusKind(status, connectLoading || statusLoading);
  const heroCopy = useMemo(() => buildHeroCopy(status, kind), [status, kind]);

  return (
    <>
      <SettingsPageHeader
        section="Payments"
        title="Payments"
        description="Your company is the merchant of record. Homeowner payments settle to your balance and pay out to your bank on Stripe's standard schedule."
      />

      <StripeStatusHero
        status={kind}
        title={heroCopy.title}
        description={heroCopy.description}
        action={
          status?.chargesEnabled ? (
            <OpenStripeDashboardButton
              onClick={openStripeDashboard}
              loading={dashboardLoading}
            />
          ) : null
        }
      />

      {status?.chargesEnabled && (
        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-gray-900">Balance &amp; upcoming payout</h2>
            <p className="text-sm text-gray-500">Live from Stripe — updated continuously.</p>
          </div>
          <StripeBalanceRow
            available={balance?.availableBalance ?? null}
            inTransit={balance?.pendingBalance ?? null}
            nextPayout={balance?.latestPayout?.amount ?? null}
            nextPayoutMeta={
              balance?.latestPayout
                ? `Expected ${formatPayoutDate(balance.latestPayout.date)}`
                : balance?.connected
                  ? 'No payout scheduled yet'
                  : '—'
            }
            loading={balanceLoading && !balance}
          />
        </section>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {status?.chargesEnabled ? 'Recent payouts' : 'Connect your business'}
            </h2>
            <p className="text-sm text-gray-500">
              {status?.chargesEnabled
                ? "From Stripe — the source of truth for what's landed in your bank."
                : 'Tell Stripe a bit about your company so homeowner payments can land in your bank.'}
            </p>
          </div>
        </div>
        <TenantStripeConnect />
      </section>
    </>
  );
}

function buildHeroCopy(
  status: ReturnType<typeof useTenantConnect>['status'],
  kind: 'active' | 'pending' | 'inactive' | 'loading',
): { title: string; description: string } {
  if (kind === 'active') {
    const acct = status?.hasAccount ? 'Stripe account connected' : '';
    return {
      title: 'Payments are active',
      description: `${acct ? `${acct} · ` : ''}Daily payout schedule`,
    };
  }
  if (kind === 'pending') {
    return {
      title: 'Verifying your account',
      description:
        'Stripe is reviewing your details. If anything else is needed, finish it below — you can come back any time.',
    };
  }
  if (kind === 'loading') {
    return {
      title: 'Loading payment status…',
      description: '',
    };
  }
  return {
    title: 'Set up payments',
    description:
      'Connect your business to start accepting homeowner payments. Your company is the merchant of record — payouts land in your bank account.',
  };
}

function formatPayoutDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
