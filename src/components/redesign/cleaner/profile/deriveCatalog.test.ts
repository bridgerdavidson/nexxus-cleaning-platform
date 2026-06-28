import { describe, expect, it } from "vitest";
import { toCatalogRow, toCatalogDetail } from "./deriveCatalog";
import type { ServiceType } from "@/hooks/useServices";
import type { ChecklistWithItems } from "@/types";

function svc(over: Partial<ServiceType> = {}): ServiceType {
  return {
    id: "s1",
    organization_id: "org1",
    name: "Standard Clean",
    description: "A solid weekly clean",
    base_price: 120,
    duration_minutes: 120,
    service_type: "regular_cleaning",
    is_active: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    ...over,
  };
}

function tier(over: Partial<ChecklistWithItems> = {}): ChecklistWithItems {
  return {
    id: "c1",
    service_type_id: "s1",
    name: "Basic",
    price_adder: 0,
    position: 0,
    created_at: "2026-01-01",
    checklist_line_items: [],
    ...over,
  } as ChecklistWithItems;
}

describe("toCatalogRow", () => {
  it("formats price (with + when paid tiers exist), duration, and type", () => {
    expect(toCatalogRow(svc(), 40)).toEqual({
      id: "s1",
      name: "Standard Clean",
      priceLabel: "$120+",
      durationLabel: "2h",
      serviceTypeLabel: "Regular Cleaning",
      isActive: true,
    });
  });
  it("omits the + when there are no paid tiers", () => {
    expect(toCatalogRow(svc(), 0).priceLabel).toBe("$120");
  });
});

describe("toCatalogDetail", () => {
  it("builds a price range from the max tier adder and maps tiers + tasks", () => {
    const detail = toCatalogDetail(svc(), [
      tier({ id: "c1", name: "Basic", price_adder: 0, checklist_line_items: [
        { id: "t1", checklist_id: "c1", task: "Vacuum", position: 0, created_at: "2026-01-01" },
      ] } as Partial<ChecklistWithItems>),
      tier({ id: "c2", name: "Plus", price_adder: 40, checklist_line_items: [
        { id: "t2", checklist_id: "c2", task: "Fridge", position: 0, created_at: "2026-01-01" },
      ] } as Partial<ChecklistWithItems>),
    ]);
    expect(detail.priceRangeLabel).toBe("$120 to $160");
    expect(detail.durationLabel).toBe("2h");
    expect(detail.tiers).toEqual([
      { id: "c1", name: "Basic", adderLabel: "Included", tasks: [{ id: "t1", task: "Vacuum" }] },
      { id: "c2", name: "Plus", adderLabel: "+$40", tasks: [{ id: "t2", task: "Fridge" }] },
    ]);
  });
  it("shows a single price when no tier adds cost", () => {
    expect(toCatalogDetail(svc(), [tier()]).priceRangeLabel).toBe("$120");
  });
});
