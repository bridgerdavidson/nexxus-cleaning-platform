'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useCleanerConnect } from '@/hooks/useCleanerConnect';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { sectionVisibleToRole } from '@/lib/settings';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import StripeStatusHero, {
  OpenStripeDashboardButton,
} from '@/components/settings/StripeStatusHero';
import { cleanerStatusKind } from '@/components/CleanerStripeConnect';
import PayoutsSection from '@/components/PayoutsSection';

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

      <PayoutsSection
        variant="cleaner"
        connected={!!connectStatus?.onboarding_complete}
      />
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
