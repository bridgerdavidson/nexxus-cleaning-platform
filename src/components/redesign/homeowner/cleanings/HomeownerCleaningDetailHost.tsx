'use client';

import { useDetailParam } from '@/hooks/useDetailParam';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { HomeownerCleaningDetail } from './HomeownerCleaningDetail';

export function HomeownerCleaningDetailHost() {
  const { paramId, setParam } = useDetailParam('appointment');
  const { appointments, loading } = useHomeownerAppointments();

  if (!paramId) return null;
  const appointment = appointments.find((a) => a.id === paramId) ?? null;

  return (
    <HomeownerCleaningDetail
      key={paramId}
      appointment={appointment}
      loading={loading}
      onClose={() => setParam(null)}
    />
  );
}
