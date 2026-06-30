'use client';

import { useMemo } from 'react';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { resolvePrimaryOfficeContact, type OfficeContact } from '@/components/redesign/cleaner/messages/office-contacts';

/** The homeowner's default "office" recipient (owner -> admin -> manager). */
export function useHomeownerOfficeContact(): { office: OfficeContact | null; loading: boolean } {
  const { members, loading } = useOrganizationMembers({ excludeCurrentUser: true });
  const office = useMemo(() => resolvePrimaryOfficeContact(members), [members]);
  return { office, loading };
}
