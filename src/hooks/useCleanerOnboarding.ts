'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { useOnboardingFlags } from '@/hooks/useOnboardingFlags';
import { useJustCompleted } from '@/lib/onboarding/useJustCompleted';
import { keys } from '@/lib/queryKeys';
import { getSetupSteps } from '@/lib/onboarding/onboardingConfig';
import { deriveChecklist } from '@/lib/onboarding/deriveChecklist';
import type { WelcomeVariant } from '@/lib/onboarding/welcomeCopy';
import { markWelcomeSeen, dismissUserChecklist } from '@/lib/onboarding/onboardingFlags';
import type { OnboardingState } from '@/hooks/useOperatorOnboarding';

export function useCleanerOnboarding(): OnboardingState {
  const { user } = useAuth();
  const qc = useQueryClient();
  const flags = useOnboardingFlags();
  const { connectStatus, statusLoading } = useStripeConnect();

  const signals: Record<string, boolean> = {
    payouts_connected: connectStatus?.onboarding_complete === true,
    profile_complete: !!user?.profile?.avatarUrl,
  };
  const vm = deriveChecklist(getSetupSteps('cleaner', 'percentage_contractor'), signals);
  const justCompleted = useJustCompleted(vm.allRequiredComplete);

  const loading = flags.loading || statusLoading;
  const invalidate = () => { if (user?.id) void qc.invalidateQueries({ queryKey: keys.onboarding.flags(user.id) }); };

  return {
    model: 'percentage_contractor',
    vm,
    showChecklist: !loading && !flags.userChecklistDismissed && !vm.allRequiredComplete,
    showSuccess: !loading && justCompleted && !flags.userChecklistDismissed,
    showWelcome: !loading && !flags.welcomeSeen,
    welcomeVariant: (vm.allRequiredComplete ? 'reorientation' : 'setup') as WelcomeVariant,
    firstName: user?.profile?.firstName ?? null,
    loading,
    onDismiss: async () => { if (user?.id) { await dismissUserChecklist(user.id); invalidate(); } },
    onWelcomeDone: async () => { if (user?.id) { await markWelcomeSeen(user.id); invalidate(); } },
  };
}
