'use client';

import { useMemo } from 'react';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { useHomeownerRequests } from '@/hooks/useHomeownerRequests';
import { pickHeroAppointment } from './home-presenters';
import { deriveHomeownerSeries } from './derive-homeowner-series';
import { HomeownerCleaningHero } from '../HomeownerCleaningHero';
import { HomeownerRepeatingCard } from './HomeownerRepeatingCard';
import { PendingRequestCard } from './PendingRequestCard';
import { useOpenCleaning } from '../cleanings/useOpenCleaning';
import { useHomeownerOnboarding } from '@/hooks/useHomeownerOnboarding';
import { SetupChecklistCard } from '@/components/redesign/onboarding/SetupChecklistCard';
import { SetupCompleteCard } from '@/components/redesign/onboarding/SetupCompleteCard';
import { WelcomeContent } from '@/components/redesign/onboarding/WelcomeContent';
import { getWelcomeCopy } from '@/lib/onboarding/welcomeCopy';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function HomeownerHome() {
  const { appointments, loading } = useHomeownerAppointments();
  const { requests, cancelRequest, cancelling } = useHomeownerRequests();
  const openCleaning = useOpenCleaning();
  const onboarding = useHomeownerOnboarding();
  const today = todayStr();
  const hero = useMemo(() => pickHeroAppointment(appointments, today), [appointments, today]);
  const seriesGroups = useMemo(() => deriveHomeownerSeries(appointments, today), [appointments, today]);

  return (
    <>
    <div className="flex flex-col gap-4 pb-8">
      {loading ? (
        <div className="h-40 animate-pulse rounded-card bg-muted" aria-hidden />
      ) : (
        <HomeownerCleaningHero appointment={hero} onOpen={openCleaning} />
      )}

      {seriesGroups.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Repeating cleanings
          </h2>
          {seriesGroups.map((s) => (
            <HomeownerRepeatingCard key={s.seriesId} series={s} onOpenCleaning={openCleaning} />
          ))}
        </section>
      )}

      {onboarding.showChecklist && (
        <section>
          <SetupChecklistCard
            title="Get ready for your first cleaning"
            subtitle={`${onboarding.vm.requiredRemaining} step${onboarding.vm.requiredRemaining === 1 ? '' : 's'} left to get set up`}
            vm={onboarding.vm}
            onDismiss={onboarding.onDismiss}
          />
        </section>
      )}
      {!onboarding.showChecklist && onboarding.showSuccess && (
        <section>
          <SetupCompleteCard onDismiss={onboarding.onDismiss} />
        </section>
      )}

      {requests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Pending requests
          </h2>
          {requests.map((r) => (
            <PendingRequestCard
              key={r.id}
              request={r}
              onCancel={cancelRequest}
              cancelling={cancelling}
            />
          ))}
        </section>
      )}
    </div>
      {onboarding.showWelcome && (
        <MobileTakeover ariaLabel="Welcome" onClosed={onboarding.onWelcomeDone}>
          {(close) => (
            <div className="flex min-h-full items-center justify-center bg-background px-6 py-16">
              <WelcomeContent
                copy={getWelcomeCopy('homeowner', onboarding.welcomeVariant, onboarding.firstName)}
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
