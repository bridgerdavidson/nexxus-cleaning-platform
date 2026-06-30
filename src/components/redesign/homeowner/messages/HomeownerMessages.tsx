'use client';

import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { deriveHomeownerInbox } from './deriveHomeownerInbox';
import { useHomeownerOfficeContact } from './useHomeownerOfficeContact';
import { useOpenMessageThread } from './useOpenMessageThread';
import { HomeownerMessagesView } from './HomeownerMessagesView';

export function HomeownerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { conversations: officeRows, loading: lo } = useConversations({ userId, scope: 'office' });
  const { conversations: jobRows, loading: lj } = useConversations({ userId, scope: 'job' });
  const { appointments, loading: la } = useHomeownerAppointments();
  const { office } = useHomeownerOfficeContact();
  const { openOffice, openOfficeThread, openJob } = useOpenMessageThread();

  const appointmentsById = useMemo(() => {
    const m = new Map<string, (typeof appointments)[number]>();
    for (const a of appointments) m.set(a.id, a);
    return m;
  }, [appointments]);

  const model = useMemo(
    () =>
      deriveHomeownerInbox({
        officeRows,
        jobRows,
        appointmentsById,
        now: new Date(),
        currentUserId: userId,
      }),
    [officeRows, jobRows, appointmentsById, userId],
  );

  return (
    <HomeownerMessagesView
      model={model}
      loading={lo || lj || la}
      onOpenOffice={() => {
        if (model.office) openOfficeThread(model.office.id);
        else if (office) openOffice(office.id);
      }}
      onOpenOfficeThread={openOfficeThread}
      onOpenJob={openJob}
    />
  );
}
