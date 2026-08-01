'use client';

import { useMemo } from 'react';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { deriveCleanings } from './derive-cleanings';
import { HomeownerCleaningsView } from './HomeownerCleaningsView';
import { useOpenCleaning } from './useOpenCleaning';

export function HomeownerCleanings() {
  const { appointments, loading, error, refetch } = useHomeownerAppointments();
  const open = useOpenCleaning();
  const { sections, isEmpty } = useMemo(() => deriveCleanings(appointments), [appointments]);

  return (
    <>
      {/* Page h1: the top bar now carries the company logo (white-label PR 4). */}
      <h1 className="mb-4 text-2xl font-extrabold leading-tight">Cleanings</h1>
      <HomeownerCleaningsView
      sections={sections}
      isEmpty={isEmpty}
      loading={loading}
      error={Boolean(error)}
      onRetry={() => refetch()}
      onOpen={open}
    />
    </>
  );
}
