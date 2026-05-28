'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useCleanerConnect } from '@/hooks/useCleanerConnect';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { sectionVisibleToRole } from '@/lib/settings';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import StripeStatusHero, {
  OpenStripeDashboardButton,
} from '@/components/settings/StripeStatusHero';
import StripeBalanceRow from '@/components/settings/StripeBalanceRow';
import CleanerStripeConnect, {
  cleanerStatusKind,
} from '@/components/CleanerStripeConnect';

type CleanerBalance = {
  connected: boolean;
  availableBalance: number;
  pendingBalance: number;
  latestPayout: { amount: number; date: number } | null;
};

export default function PayoutsSettingsPage() {
  const router = useRouter();
  const { user, currentOrgRole, loading: authLoading } = useAuth();
  const { connectStatus, statusLoading, handleOpenStripeDashboard, dashboardLoading } =
    useStripeConnect();
  const { loading: connectLoading } = useCleanerConnect();

  // Client-side role gate.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (
      !sectionVisibleToRole('payouts', user.role, currentOrgRole ?? undefined, null)
    ) {
      router.replace('/settings');
    }
  }, [authLoading, user, currentOrgRole, router]);

  // Balance fetch (cleaner) — only when active.
  const [balance, setBalance] = useState<CleanerBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  useEffect(() => {
    if (!user?.id || !connectStatus?.onboarding_complete) return;
    let cancelled = false;
    (async () => {
      setBalanceLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch('/api/stripe/connect/balance-summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ cleaner_id: user.id }),
        });
        const data = (await res.json().catch(() => null)) as CleanerBalance | null;
        if (cancelled || !data) return;
        setBalance(data);
      } catch {
        // Embedded ConnectPayouts is the fallback source of truth.
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, connectStatus?.onboarding_complete]);

  const kind = cleanerStatusKind(connectStatus, connectLoading || statusLoading);
  const heroCopy = useMemo(() => buildHeroCopy(kind), [kind]);

  return (
    <>
      <SettingsPageHeader
        section="Payouts"
        title="Payouts"
        description="Receive automatic payouts to your bank when jobs complete."
      />

      <StripeStatusHero
        status={kind}
        title={heroCopy.title}
        description={heroCopy.description}
        action={
          connectStatus?.onboarding_complete ? (
            <OpenStripeDashboardButton
              onClick={() => void handleOpenStripeDashboard()}
              loading={dashboardLoading}
            />
          ) : null
        }
      />

      {connectStatus?.onboarding_complete && (
        <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-gray-900">Your balance</h2>
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
        <div className="mb-4">
          <h2 className="text-lg font-bold text-gray-900">
            {connectStatus?.onboarding_complete ? 'Recent payouts' : 'Connect your bank account'}
          </h2>
          <p className="text-sm text-gray-500">
            {connectStatus?.onboarding_complete
              ? 'From Stripe — the source of truth for what landed in your account.'
              : 'Finish Stripe setup to receive automatic payouts when jobs complete.'}
          </p>
        </div>
        <CleanerStripeConnect />
      </section>
    </>
  );
}

function buildHeroCopy(
  kind: 'active' | 'pending' | 'inactive' | 'loading',
): { title: string; description: string } {
  if (kind === 'active')
    return {
      title: 'Payouts active',
      description: 'Your Stripe account is connected. Payouts arrive automatically when jobs complete.',
    };
  if (kind === 'pending')
    return {
      title: 'Finish payout setup',
      description: 'A few details remain so Stripe can pay you out.',
    };
  if (kind === 'loading')
    return { title: 'Loading payout status…', description: '' };
  return {
    title: 'Set up payouts',
    description:
      'Connect a bank account to receive automatic payouts when jobs complete. Everything happens right here — no need to leave the app.',
  };
}

function formatPayoutDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
