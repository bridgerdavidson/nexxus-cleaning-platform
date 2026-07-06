"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useCleanerAppointments, useRespondToOffer, useRespondToSeries } from "@/hooks/useCleanerData";
import { useOpenJob } from "@/components/redesign/cleaner/job/useOpenJob";
import { NEEDS_ATTENTION_DAYS } from "../shared/zones";
import { deriveToday } from "./deriveToday";
import { CleanerTodayView } from "./CleanerTodayView";
import { useCleanerOnboarding } from "@/hooks/useCleanerOnboarding";
import { SetupChecklistCard } from "@/components/redesign/onboarding/SetupChecklistCard";
import { SetupCompleteCard } from "@/components/redesign/onboarding/SetupCompleteCard";
import { WelcomeContent } from "@/components/redesign/onboarding/WelcomeContent";
import { getWelcomeCopy } from "@/lib/onboarding/welcomeCopy";
import { MobileTakeover } from "@/components/redesign/shared/MobileTakeover";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CleanerToday() {
  const router = useRouter();
  const openJob = useOpenJob();
  const { currentOrganization } = useAuth();
  const { appointments, loading, error, refetch } = useCleanerAppointments();
  const respond = useRespondToOffer();
  const series = useRespondToSeries();
  const onboarding = useCleanerOnboarding();

  const payoutModel = currentOrganization?.default_payout_model ?? "percentage_contractor";
  const now = new Date();
  const todayStr = ymd(now);
  const graceFloorStr = ymd(new Date(now.getTime() - NEEDS_ATTENTION_DAYS * 864e5));
  const data = deriveToday(appointments, todayStr, ymd(new Date(now.getTime() + 864e5)), graceFloorStr, payoutModel);

  const checklistSlot = onboarding.showChecklist ? (
    <SetupChecklistCard
      title="Get set up"
      subtitle={`${onboarding.vm.requiredRemaining} step${onboarding.vm.requiredRemaining === 1 ? '' : 's'} left to get set up`}
      vm={onboarding.vm}
      onDismiss={onboarding.onDismiss}
    />
  ) : onboarding.showSuccess ? (
    <SetupCompleteCard onDismiss={onboarding.onDismiss} />
  ) : null;

  return (
    <>
      <CleanerTodayView
        data={data}
        loading={loading}
        error={Boolean(error)}
        onRetry={() => refetch()}
        onContinueActive={() => data.activeJob && openJob(data.activeJob.id)}
        onOpenJob={openJob}
        todayStr={todayStr}
        onAcceptOffer={(id, slotIndex) => respond.accept.mutateAsync({ appointmentId: id, slotIndex })}
        onDeclineOffer={(id, reason, other) => respond.decline.mutateAsync({ appointmentId: id, reason, other })}
        onAcceptSeries={(seriesId) => series.acceptAll(seriesId)}
        onDeclineSeries={(seriesId, reason, other) => series.declineAll(seriesId, reason, other)}
        onSeeTomorrow={() => router.push("/app/cleaner-dashboard/schedule")}
        checklist={checklistSlot}
      />
      {onboarding.showWelcome && (
        <MobileTakeover ariaLabel="Welcome" onClosed={onboarding.onWelcomeDone}>
          {(close) => (
            <div className="flex min-h-full items-center justify-center bg-background px-6 py-16">
              <WelcomeContent
                copy={getWelcomeCopy('cleaner', onboarding.welcomeVariant, onboarding.firstName)}
                onPrimary={close}
                onSkip={close}
              />
            </div>
          )}
        </MobileTakeover>
      )}
    </>
  );
}
