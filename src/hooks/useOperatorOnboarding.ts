'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useInvites } from '@/hooks/useInvites';
import { useOnboardingFlags } from '@/hooks/useOnboardingFlags';
import { keys } from '@/lib/queryKeys';
import { getSetupSteps, type OrgModel } from '@/lib/onboarding/onboardingConfig';
import { deriveChecklist, type ChecklistVM } from '@/lib/onboarding/deriveChecklist';
import type { WelcomeVariant } from '@/lib/onboarding/welcomeCopy';
import { markWelcomeSeen, dismissOrgChecklist } from '@/lib/onboarding/onboardingFlags';
import { useJustCompleted } from '@/lib/onboarding/useJustCompleted';

export interface OnboardingState {
  model: OrgModel;
  vm: ChecklistVM;
  showChecklist: boolean;
  showSuccess: boolean;
  showWelcome: boolean;
  welcomeVariant: WelcomeVariant;
  firstName: string | null;
  loading: boolean;
  onDismiss: () => void;
  onWelcomeDone: () => void;
}

export function useOperatorOnboarding(): OnboardingState {
  const { user, currentOrganizationId, accessToken, currentOrgRole } = useAuth();
  const orgId = currentOrganizationId ?? null;
  const qc = useQueryClient();
  const flags = useOnboardingFlags();
  // Invites only feed the owner-only setup checklist; /api/invites 403s for
  // managers without can_manage_cleaners, so don't fetch for non-owners.
  const { invites } = useInvites(orgId, accessToken, {
    enabled: currentOrgRole === 'owner',
  });

  const orgQuery = useQuery({
    queryKey: keys.onboarding.operator(orgId ?? 'none'),
    enabled: !!orgId,
    queryFn: async () => {
      const [orgRes, svcRes, cleanerRes] = await Promise.all([
        supabase
          .from('organizations')
          .select('stripe_connect_charges_enabled, default_payout_model, payout_configured_at, hours_policy_configured_at, setup_checklist_dismissed_at, brand_color, logo_icon_url')
          .eq('id', orgId as string)
          .maybeSingle(),
        supabase.from('service_types').select('id', { count: 'exact', head: true }).eq('organization_id', orgId as string),
        supabase.from('organization_members').select('user_id', { count: 'exact', head: true }).eq('organization_id', orgId as string).eq('role', 'cleaner'),
      ]);
      const org = (orgRes.data ?? {}) as {
        stripe_connect_charges_enabled?: boolean;
        default_payout_model?: OrgModel;
        payout_configured_at?: string | null;
        hours_policy_configured_at?: string | null;
        setup_checklist_dismissed_at?: string | null;
        brand_color?: string | null;
        logo_icon_url?: string | null;
      };
      return {
        chargesEnabled: !!org.stripe_connect_charges_enabled,
        model: (org.default_payout_model ?? 'percentage') as OrgModel,
        payoutConfigured: !!org.payout_configured_at,
        hoursConfigured: !!org.hours_policy_configured_at,
        orgDismissed: !!org.setup_checklist_dismissed_at,
        // Either signal is enough: brand_color and logo_icon_url are exactly
        // what the white-label emails consume (inviteEmail/recoveryEmail).
        brandingSet: !!org.brand_color || !!org.logo_icon_url,
        serviceCount: svcRes.count ?? 0,
        cleanerCount: cleanerRes.count ?? 0,
      };
    },
  });

  const data = orgQuery.data;
  const model: OrgModel = data?.model ?? 'percentage';

  const outstandingCleanerInvites = (invites ?? []).filter(
    (i) => i.role === 'cleaner' && (i.status === 'pending' || i.status === 'creating'),
  ).length;

  const signals: Record<string, boolean> = {
    payments_connected: !!data?.chargesEnabled,
    services_added: (data?.serviceCount ?? 0) > 0,
    cleaner_pay_set: !!data?.payoutConfigured,
    branding_set: !!data?.brandingSet,
    cleaners_invited: (data?.cleanerCount ?? 0) > 0 || outstandingCleanerInvites > 0,
    hours_policy_set: !!data?.hoursConfigured,
  };

  const vm = deriveChecklist(getSetupSteps('operator', model), signals);

  const loading = orgQuery.isLoading || flags.loading;
  const justCompleted = useJustCompleted(vm.allRequiredComplete, !loading);
  const showChecklist = !loading && !data?.orgDismissed && !vm.allRequiredComplete;
  const showSuccess = !loading && justCompleted && !data?.orgDismissed;
  const showWelcome = !loading && !flags.welcomeSeen;
  const welcomeVariant: WelcomeVariant = vm.allRequiredComplete ? 'reorientation' : 'setup';

  const invalidate = () => {
    if (orgId) void qc.invalidateQueries({ queryKey: keys.onboarding.operator(orgId) });
    if (user?.id) void qc.invalidateQueries({ queryKey: keys.onboarding.flags(user.id) });
  };

  return {
    model,
    vm,
    showChecklist,
    showSuccess,
    showWelcome,
    welcomeVariant,
    firstName: user?.profile?.firstName ?? null,
    loading,
    onDismiss: async () => {
      if (!orgId || !accessToken) return;
      try {
        await dismissOrgChecklist(orgId, accessToken);
      } catch {
        // swallow — route may 403 for non-privileged roles; don't reject unhandled
      }
      invalidate();
    },
    onWelcomeDone: async () => {
      if (!user?.id) return;
      await markWelcomeSeen(user.id);
      invalidate();
    },
  };
}
