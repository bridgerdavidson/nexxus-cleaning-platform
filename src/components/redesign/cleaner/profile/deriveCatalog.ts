import type { ServiceType } from "@/hooks/useServices";
import type { ChecklistWithItems } from "@/types";
import {
  rowPriceLabel,
  priceRangeLabel,
  priceAdderLabel,
  formatDuration,
  serviceTypeLabel,
} from "@/components/redesign/services/deriveServices";
import type { CatalogRowVM, CatalogDetailVM, CatalogTierVM } from "./profile-types";

/** A list row for the read-only catalog. `maxAdder` is the org's max tier
 *  price-adder for this service (from useServices.maxChecklistAdderByServiceId),
 *  used only to show "$120+" when paid tiers exist. */
export function toCatalogRow(service: ServiceType, maxAdder: number): CatalogRowVM {
  return {
    id: service.id,
    name: service.name,
    priceLabel: rowPriceLabel(service.base_price, Math.max(0, maxAdder)),
    durationLabel: formatDuration(service.duration_minutes),
    serviceTypeLabel: serviceTypeLabel(service.service_type),
    isActive: service.is_active,
  };
}

/** The read-only detail view-model: a price range derived from the tiers, plus
 *  each tier's tasks. Tiers/tasks arrive pre-sorted from useChecklists. */
export function toCatalogDetail(service: ServiceType, checklists: ChecklistWithItems[]): CatalogDetailVM {
  const maxAdder = checklists.reduce((m, c) => Math.max(m, Number(c.price_adder) || 0), 0);
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    priceRangeLabel: priceRangeLabel(service.base_price, maxAdder),
    durationLabel: formatDuration(service.duration_minutes),
    serviceTypeLabel: serviceTypeLabel(service.service_type),
    tiers: checklists.map(
      (c): CatalogTierVM => ({
        id: c.id,
        name: c.name,
        adderLabel: (Number(c.price_adder) || 0) === 0 ? "Included" : priceAdderLabel(c.price_adder),
        tasks: (c.checklist_line_items ?? []).map((it) => ({ id: it.id, task: it.task })),
      }),
    ),
  };
}
