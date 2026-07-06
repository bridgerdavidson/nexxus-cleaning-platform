'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useHomeownerProperties } from '@/hooks/useHomeownerData';
import { useSavedPaymentMethods } from '@/components/redesign/homeowner/account/payment-methods/useSavedPaymentMethods';
import { useOnboardingFlags } from '@/hooks/useOnboardingFlags';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';
import { keys } from '@/lib/queryKeys';
import { getSetupSteps } from '@/lib/onboarding/onboardingConfig';
import { deriveChecklist } from '@/lib/onboarding/deriveChecklist';
import type { WelcomeVariant } from '@/lib/onboarding/welcomeCopy';
import { markWelcomeSeen, dismissUserChecklist } from '@/lib/onboarding/onboardingFlags';
import { useJustCompleted } from '@/lib/onboarding/useJustCompleted';
import type { OnboardingState } from '@/hooks/useOperatorOnboarding';

export function useHomeownerOnboarding(): OnboardingState {
  const { user } = useAuth();
  const qc = useQueryClient();
  const flags = useOnboardingFlags();
  const { properties, loading: propsLoading } = useHomeownerProperties();
  const cardsEnabled = stripeNewChargeFlowUiEnabled();
  const { cards, loading: cardsLoading } = useSavedPaymentMethods();

  const allSteps = getSetupSteps('homeowner', 'percentage_contractor');
  const steps = cardsEnabled ? allSteps : allSteps.filter((s) => s.key !== 'card');

  const signals: Record<string, boolean> = {
    home_added: (properties?.length ?? 0) > 0,
    payment_method_added: (cards?.length ?? 0) > 0,
  };
  const vm = deriveChecklist(steps, signals);

  const loading = flags.loading || propsLoading || (cardsEnabled && cardsLoading);
  const justCompleted = useJustCompleted(vm.allRequiredComplete, !loading);
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
