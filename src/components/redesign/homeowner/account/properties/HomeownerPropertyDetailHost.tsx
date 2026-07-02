'use client';

import { useDetailParam } from '@/hooks/useDetailParam';
import { useHomeownerProperties } from '@/hooks/useHomeownerData';
import { HomeownerPropertyDetail } from './HomeownerPropertyDetail';

export function HomeownerPropertyDetailHost() {
  const { paramId, setParam } = useDetailParam('property');
  const { properties, loading } = useHomeownerProperties();

  if (!paramId) return null;
  const property = properties.find((p) => p.id === paramId) ?? null;

  return (
    <HomeownerPropertyDetail
      key={paramId}
      property={property}
      loading={loading}
      onClose={() => setParam(null)}
    />
  );
}
