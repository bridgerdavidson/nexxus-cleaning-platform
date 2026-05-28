'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { sectionVisibleToRole } from '@/lib/settings';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import OrgPaymentSettings from '@/components/OrgPaymentSettings';

export default function CancellationPolicyPage() {
  const router = useRouter();
  const { user, currentOrgRole, loading } = useAuth();
  const { permissions } = useManagerPermissions();

  // Client-side role gate. Owner/admin always pass; managers need can_manage_payments.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (
      !sectionVisibleToRole(
        'cancellation-policy',
        user.role,
        currentOrgRole ?? undefined,
        permissions,
      )
    ) {
      router.replace('/settings');
    }
  }, [loading, user, currentOrgRole, permissions, router]);

  return (
    <>
      <SettingsPageHeader
        section="Cancellation policy"
        title="Cancellation policy"
        description="When a homeowner cancels late or no-shows, this fee is captured from their card hold. The rest of the hold is released. Cleaner-caused or on-time cancellations are always free."
      />
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <OrgPaymentSettings />
      </div>
    </>
  );
}
