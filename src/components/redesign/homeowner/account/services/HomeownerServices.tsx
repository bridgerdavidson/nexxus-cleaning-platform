'use client';

import { useServices } from '@/hooks/useServices';
import { toCatalogRow } from '@/components/redesign/cleaner/profile/deriveCatalog';
import { isBookableService } from '@/components/redesign/homeowner/booking/deriveBooking';
import { useOpenService } from './useOpenService';
import { HomeownerServicesView } from './HomeownerServicesView';
import { HomeownerServiceDetailHost } from './HomeownerServiceDetailHost';

/** Read-only services catalog + a ?service= detail takeover. Reuses the
 *  cleaner catalog derive; bookable services only (active and priced at least
 *  $1), matching the booking picker so every row's Book action works. */
export function HomeownerServices() {
  const { services, loading, error, refetch, maxChecklistAdderByServiceId } = useServices();
  const openService = useOpenService();

  const rows = services
    .filter(isBookableService)
    .map((s) => toCatalogRow(s, maxChecklistAdderByServiceId[s.id] ?? 0));

  return (
    <>
      <HomeownerServicesView rows={rows} loading={loading} error={Boolean(error)} onRetry={() => refetch()} onOpen={openService} />
      <HomeownerServiceDetailHost />
    </>
  );
}
