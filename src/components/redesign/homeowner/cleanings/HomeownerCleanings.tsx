'use client';

import { useMemo } from 'react';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { deriveCleanings } from './derive-cleanings';
import { HomeownerCleaningsView } from './HomeownerCleaningsView';
import { useOpenCleaning } from './useOpenCleaning';

export function HomeownerCleanings() {
  const { appointments, loading } = useHomeownerAppointments();
  const open = useOpenCleaning();
  const { sections, isEmpty } = useMemo(() => deriveCleanings(appointments), [appointments]);

  return (
    <HomeownerCleaningsView
      sections={sections}
      isEmpty={isEmpty}
      loading={loading}
      onOpen={open}
    />
  );
}
