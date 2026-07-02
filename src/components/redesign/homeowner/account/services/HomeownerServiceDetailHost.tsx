'use client';

import { useDetailParam } from '@/hooks/useDetailParam';
import { HomeownerServiceDetail } from './HomeownerServiceDetail';

export function HomeownerServiceDetailHost() {
  const { paramId, setParam } = useDetailParam('service');
  if (!paramId) return null;
  return <HomeownerServiceDetail key={paramId} serviceId={paramId} onClose={() => setParam(null)} />;
}
