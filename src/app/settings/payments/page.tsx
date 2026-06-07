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
import { tenantStatusKind } from '@/components/TenantStripeConnect';
import PayoutsSection from '@/components/PayoutsSection';
import OrgPaymentMethodSection from '@/components/OrgPaymentMethodSection';

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

  // Only the owner runs Stripe setup (onboarding + the Express dashboard). Admins
  // and managers-with-can_manage_payments see the financials read-only.
  const isOwner = currentOrgRole === 'owner';
  const kind = tenantStatusKind(status, connectLoading || statusLoading);
  const heroCopy = useMemo(() => buildHeroCopy(status, kind, isOwner), [status, kind, isOwner]);

  // Owner/admin always manage payments; managers need the explicit can_manage_payments flag.
  const canManagePayments =
    currentOrgRole === 'owner' ||
    currentOrgRole === 'admin' ||
    (currentOrgRole === 'manager' && !!permissions?.can_manage_payments);

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
          status?.chargesEnabled && isOwner ? (
            <OpenStripeDashboardButton
              onClick={openStripeDashboard}
              loading={dashboardLoading}
            />
          ) : null
        }
      />

      {canManagePayments && currentOrganizationId && (
        <OrgPaymentMethodSection organizationId={currentOrganizationId} />
      )}

      <PayoutsSection variant="tenant" connected={!!status?.chargesEnabled} />
    </>
  );
}

function buildHeroCopy(
  status: ReturnType<typeof useTenantConnect>['status'],
  kind: 'active' | 'pending' | 'inactive' | 'loading',
  isOwner: boolean,
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
      description: isOwner
        ? 'Stripe is reviewing your details. If anything else is needed, finish it below — you can come back any time.'
        : 'Stripe is reviewing your organization’s details. Your owner finishes any remaining steps; balances and payouts appear here once it’s done.',
    };
  }
  if (kind === 'loading') {
    return {
      title: 'Loading payment status…',
      description: '',
    };
  }
  // Inactive: only the owner sees a setup call-to-action. Non-owners get a
  // read-only "your owner is setting this up" message instead of dead CTAs.
  return isOwner
    ? {
        title: 'Set up payments',
        description:
          'Connect your business to start accepting homeowner payments. Your company is the merchant of record, so payouts land in your bank account.',
      }
    : {
        title: 'Payments aren’t set up yet',
        description:
          'Your organization owner needs to connect the business before payments and balances show up here.',
      };
}
