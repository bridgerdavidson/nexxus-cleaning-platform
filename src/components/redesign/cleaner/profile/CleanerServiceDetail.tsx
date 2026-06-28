"use client";

import { useService } from "@/hooks/useServices";
import { useChecklists } from "@/hooks/useChecklists";
import { toCatalogDetail } from "./deriveCatalog";
import { CleanerServiceDetailView } from "./CleanerServiceDetailView";

export function CleanerServiceDetail({ serviceId }: { serviceId: string }) {
  const { service, loading: serviceLoading } = useService(serviceId);
  const { checklists, loading: checklistsLoading } = useChecklists(serviceId);
  const detail = service ? toCatalogDetail(service, checklists) : null;
  return (
    <CleanerServiceDetailView
      detail={detail}
      loading={serviceLoading}
      checklistsLoading={checklistsLoading}
    />
  );
}
