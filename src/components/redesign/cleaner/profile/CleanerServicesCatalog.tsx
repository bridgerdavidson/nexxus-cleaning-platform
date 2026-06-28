"use client";

import { useServices } from "@/hooks/useServices";
import { toCatalogRow } from "./deriveCatalog";
import { CleanerServicesCatalogView } from "./CleanerServicesCatalogView";

export function CleanerServicesCatalog() {
  const { services, loading, maxChecklistAdderByServiceId } = useServices();
  const rows = services
    .filter((s) => s.is_active)
    .map((s) => toCatalogRow(s, maxChecklistAdderByServiceId[s.id] ?? 0));
  return <CleanerServicesCatalogView rows={rows} loading={loading} />;
}
