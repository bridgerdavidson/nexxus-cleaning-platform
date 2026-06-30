'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { useStartConversation } from '@/hooks/useStartConversation';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { filterOfficeContacts, type OfficeContact } from '@/components/redesign/cleaner/messages/office-contacts';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import type { UserRole } from '@/types';
import { HomeownerMessageThread } from './HomeownerMessageThread';

export function HomeownerMessageThreadHost() {
  const sp = useSearchParams();
  const to = sp.get('to');
  const thread = sp.get('thread');
  const job = sp.get('job');
  if (!to && !thread && !job) return null;
  return <HostInner toParam={to} threadParam={thread} jobParam={job} />;
}

function HostInner({ toParam, threadParam, jobParam }: { toParam: string | null; threadParam: string | null; jobParam: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const isJob = !!jobParam;
  const { conversations: officeConvs } = useConversations({ userId, scope: 'office' });
  const { conversations: jobConvs } = useConversations({ userId, scope: 'job' });
  const { members } = useOrganizationMembers({ excludeCurrentUser: true });
  const { appointments } = useHomeownerAppointments();
  const { startConversation } = useStartConversation();

  // ---- Office recipient resolution (?to / ?thread) ----
  const officeContacts = useMemo(() => filterOfficeContacts(members), [members]);
  const officeRecipient: OfficeContact | null = useMemo(() => {
    if (toParam) return officeContacts.find((o) => o.id === toParam) ?? null;
    if (threadParam) {
      const p = officeConvs.find((c) => c.id === threadParam)?.other_participant;
      if (!p) return null;
      return {
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email || 'Office',
        role: (p.role as UserRole) ?? 'admin',
        orgRole: '',
        avatarUrl: p.avatar_url ?? null,
      };
    }
    return null;
  }, [toParam, threadParam, officeContacts, officeConvs]);

  const [officeConvId, setOfficeConvId] = useState<string | null>(threadParam);
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (toParam) {
      if (startedForRef.current === toParam) return;
      startedForRef.current = toParam;
      startConversation(toParam).then((res) => {
        if (res.success && res.conversationId) setOfficeConvId(res.conversationId);
      });
    } else {
      startedForRef.current = null;
      setOfficeConvId(threadParam);
    }
  }, [toParam, threadParam, startConversation]);

  // ---- Job thread resolution (?job) ----
  const jobAppt = useMemo(() => (jobParam ? appointments.find((a) => a.id === jobParam) ?? null : null), [jobParam, appointments]);
  const jobConvId = useMemo(() => {
    if (!jobParam) return null;
    const matches = jobConvs.filter((c) => c.appointment_id === jobParam);
    if (jobAppt?.cleaner_id) {
      const current = matches.find(
        (c) => c.participant_1_id === jobAppt.cleaner_id || c.participant_2_id === jobAppt.cleaner_id,
      );
      if (current) return current.id;
    }
    return null; // no conversation with the CURRENT cleaner yet -> first send creates it
  }, [jobParam, jobConvs, jobAppt]);

  const close = useCallback(() => {
    const next = new URLSearchParams(sp.toString());
    next.delete('to');
    next.delete('thread');
    next.delete('job');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp]);

  const ready = isJob ? !!jobAppt : !!officeRecipient;

  return (
    <MobileTakeover key={jobParam ?? threadParam ?? toParam ?? ''} onClosed={close} ariaLabel={isJob ? 'Cleaning conversation' : 'Office conversation'}>
      {(closeTakeover) =>
        ready ? (
          isJob && jobAppt ? (
            <HomeownerMessageThread
              config={{
                kind: 'job',
                appointment: jobAppt,
                cleanerName:
                  `${jobAppt.cleaner_profile?.user_profile?.first_name ?? ''} ${jobAppt.cleaner_profile?.user_profile?.last_name ?? ''}`.trim() ||
                  'Your cleaner',
                avatarUrl: jobAppt.cleaner_profile?.user_profile?.avatar_url ?? null,
                readOnly: !isJobMessagingWindowOpen(
                  {
                    status: jobAppt.status,
                    cleaner_confirmation_status: jobAppt.cleaner_confirmation_status ?? null,
                    completed_at: jobAppt.completed_at ?? null,
                    cancelled_at: jobAppt.cancelled_at ?? null,
                  },
                  new Date(),
                ),
              }}
              conversationId={jobConvId}
              onBack={closeTakeover}
            />
          ) : officeRecipient ? (
            <HomeownerMessageThread config={{ kind: 'office', recipient: officeRecipient }} conversationId={officeConvId} onBack={closeTakeover} />
          ) : null
        ) : (
          <div className="grid h-full place-items-center bg-card">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading conversation" />
          </div>
        )
      }
    </MobileTakeover>
  );
}
