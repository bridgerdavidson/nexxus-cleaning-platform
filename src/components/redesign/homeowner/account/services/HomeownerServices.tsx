'use client';

import { useServices } from '@/hooks/useServices';
import { toCatalogRow } from '@/components/redesign/cleaner/profile/deriveCatalog';
import { useOpenService } from './useOpenService';
import { HomeownerServicesView } from './HomeownerServicesView';
import { HomeownerServiceDetailHost } from './HomeownerServiceDetailHost';

/** Read-only services catalog + a ?service= detail takeover. Reuses the
 *  cleaner catalog derive; active services only. */
export function HomeownerServices() {
  const { services, loading, error, refetch, maxChecklistAdderByServiceId } = useServices();
  const openService = useOpenService();

  const rows = services
    .filter((s) => s.is_active)
    .map((s) => toCatalogRow(s, maxChecklistAdderByServiceId[s.id] ?? 0));

  return (
    <>
      <HomeownerServicesView rows={rows} loading={loading} error={Boolean(error)} onRetry={() => refetch()} onOpen={openService} />
      <HomeownerServiceDetailHost />
    </>
  );
}
