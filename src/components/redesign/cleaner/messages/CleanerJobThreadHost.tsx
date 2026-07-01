'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useCleanerAppointments } from '@/hooks/useCleanerData';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { CleanerJobThread } from './CleanerJobThread';

/**
 * Mounts the cleaner's homeowner<->cleaner JOB thread takeover from
 * `?jobthread=<appointmentId>` (+ optional `?from=<jobId>` for a Back-to-job
 * return). Layout sibling, like CleanerMessageThreadHost. Heavy hooks mount only
 * when a job thread is open.
 */
export function CleanerJobThreadHost() {
  const searchParams = useSearchParams();
  const jobThreadParam = searchParams.get('jobthread');
  if (!jobThreadParam) return null;
  return <JobThreadHostInner appointmentId={jobThreadParam} fromParam={searchParams.get('from')} />;
}

function JobThreadHostInner({
  appointmentId,
  fromParam,
}: {
  appointmentId: string;
  fromParam: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const { appointments } = useCleanerAppointments();
  const { conversations } = useConversations({ userId, scope: 'job' });

  const appointment = useMemo(
    () => appointments.find((a) => a.id === appointmentId) ?? null,
    [appointments, appointmentId],
  );
  const conversationId = useMemo(
    () => conversations.find((c) => c.appointment_id === appointmentId)?.id ?? null,
    [conversations, appointmentId],
  );

  const homeownerName = appointment
    ? `${appointment.homeowner?.first_name ?? ''} ${appointment.homeowner?.last_name ?? ''}`.trim() ||
      'Homeowner'
    : 'Homeowner';
  // CleanerAppointment.homeowner carries no avatar; the initials fallback shows instead.
  const avatarUrl = null;
  // The cleaner appointment select includes completed_at/cancelled_at, so the send
  // window is accurate: a job still within the 24h post-completion grace stays
  // writable, and a completed/cancelled thread past the window is read-only.
  const readOnly = appointment
    ? !isJobMessagingWindowOpen(
        {
          status: appointment.status,
          cleaner_confirmation_status: appointment.cleaner_confirmation_status,
          completed_at: appointment.completed_at ?? null,
          cancelled_at: appointment.cancelled_at ?? null,
        },
        new Date(),
      )
    : false;

  const clearAll = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('jobthread');
    sp.delete('from');
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const backToJob = useCallback(() => {
    router.replace(`/app/cleaner-dashboard?job=${fromParam}`, { scroll: false });
  }, [router, fromParam]);

  return (
    <MobileTakeover
      key={appointmentId}
      onClosed={fromParam ? backToJob : clearAll}
      ariaLabel="Homeowner conversation"
    >
      {(close) => (
        <CleanerJobThread
          appointmentId={appointmentId}
          conversationId={conversationId}
          homeownerName={homeownerName}
          avatarUrl={avatarUrl}
          readOnly={readOnly}
          onBack={close}
          backLabel={fromParam ? 'Back to job' : undefined}
        />
      )}
    </MobileTakeover>
  );
}
