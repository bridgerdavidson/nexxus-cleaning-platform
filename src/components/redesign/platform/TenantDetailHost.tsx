'use client';

import { useEffect, useState } from 'react';
import { useDetailParam } from '@/hooks/useDetailParam';
import { useOpenTenant } from './useOpenTenant';
import { TenantDetailSheet } from './TenantDetailSheet';

/**
 * Mounts the tenant-detail sheet once for the platform shell, driven by
 * `?tenant=<id>`. Retains the last id so the sheet content persists through the
 * exit animation (mirrors OperatorPropertyDetailHost). Reads the param with
 * useDetailParam (useSearchParams), so the shell wraps this in a Suspense boundary.
 */
export function TenantDetailHost() {
  const { paramId } = useDetailParam('tenant');
  const { close } = useOpenTenant();
  const [lastId, setLastId] = useState<string | null>(null);

  useEffect(() => {
    if (paramId) setLastId(paramId);
  }, [paramId]);

  return (
    <TenantDetailSheet key={lastId ?? 'none'} tenantId={lastId} open={!!paramId} onClose={close} />
  );
}
