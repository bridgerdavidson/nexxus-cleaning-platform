'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useConversations } from '@/hooks/useConversations';
import { useCleanerAppointments } from '@/hooks/useCleanerData';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { useOpenOfficeThread } from '@/hooks/useOpenOfficeThread';
import { deriveCleanerInbox } from './deriveCleanerInbox';
import { filterOfficeContacts } from './office-contacts';
import { useOpenCleanerJobThread } from './useOpenCleanerJobThread';
import { CleanerMessagesView } from './CleanerMessagesView';
import { CleanerOfficePicker } from './CleanerOfficePicker';

/**
 * Cleaner Messages: a sectioned inbox (mirror of the homeowner tab).
 * - Office: threads with the org's admins/managers (open existing via ?thread=; the
 *   "New" picker starts one with a specific person via ?to=).
 * - Your cleanings: active homeowner<->cleaner job threads (send window open).
 * - Past: closed job threads (read-only).
 * Office threads render through the ?thread=/?to= host (CleanerMessageThreadHost); job
 * threads through the ?jobthread= host (CleanerJobThreadHost). Both are mounted in the layout.
 */
export function CleanerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { conversations: officeRows, loading: lo } = useConversations({ userId, scope: 'office' });
  const { conversations: jobRows, loading: lj } = useConversations({ userId, scope: 'job' });
  const { appointments, loading: la } = useCleanerAppointments();
  const { members, loading: lm } = useOrganizationMembers({ excludeCurrentUser: true });

  const { openConversation, openWith } = useOpenOfficeThread();
  const openJob = useOpenCleanerJobThread();
  const [pickerOpen, setPickerOpen] = useState(false);

  const officeContacts = useMemo(() => filterOfficeContacts(members), [members]);
  const appointmentsById = useMemo(() => {
    const m = new Map<string, (typeof appointments)[number]>();
    for (const a of appointments) m.set(a.id, a);
    return m;
  }, [appointments]);

  const model = useMemo(
    () =>
      deriveCleanerInbox({
        officeRows,
        jobRows,
        appointmentsById,
        now: new Date(),
        currentUserId: userId,
      }),
    [officeRows, jobRows, appointmentsById, userId],
  );

  const startOffice = () => {
    if (officeContacts.length === 0) return;
    if (officeContacts.length === 1) openWith(officeContacts[0].id);
    else setPickerOpen(true);
  };

  return (
    <>
      <CleanerMessagesView
        model={model}
        loading={lo || lj || la || lm}
        hasOfficeContacts={officeContacts.length > 0}
        onOpenOfficeRow={openConversation}
        onStartOffice={startOffice}
        onNew={() => setPickerOpen(true)}
        onOpenJob={openJob}
      />
      <CleanerOfficePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        contacts={officeContacts}
        loading={lm}
        onPick={(c) => {
          setPickerOpen(false);
          openWith(c.id);
        }}
      />
    </>
  );
}
