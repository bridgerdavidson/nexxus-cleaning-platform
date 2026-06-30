'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { deriveHomeownerInbox } from './deriveHomeownerInbox';
import { messageableCleanings } from './messageableCleanings';
import { useHomeownerOfficeContact } from './useHomeownerOfficeContact';
import { useOpenMessageThread } from './useOpenMessageThread';
import { HomeownerMessagesView } from './HomeownerMessagesView';
import { NewConversationSheet } from './NewConversationSheet';

export function HomeownerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { conversations: officeRows, loading: lo } = useConversations({ userId, scope: 'office' });
  const { conversations: jobRows, loading: lj } = useConversations({ userId, scope: 'job' });
  const { appointments, loading: la } = useHomeownerAppointments();
  const { office } = useHomeownerOfficeContact();
  const { openOffice, openOfficeThread, openJob } = useOpenMessageThread();
  const [newOpen, setNewOpen] = useState(false);

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

  const messageable = useMemo(() => messageableCleanings(appointments, new Date()), [appointments]);

  return (
    <>
      <HomeownerMessagesView
        model={model}
        loading={lo || lj || la}
        onOpenOffice={() => {
          if (office) openOffice(office.id);
        }}
        onOpenOfficeThread={openOfficeThread}
        onOpenJob={openJob}
        onNewConversation={() => setNewOpen(true)}
      />
      <NewConversationSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        hasOffice={!!office}
        cleanings={messageable}
        onPickOffice={() => {
          if (office) openOffice(office.id);
        }}
        onPickCleaning={(id) => openJob(id)}
      />
    </>
  );
}
