import { describe, it, expect } from "vitest";
import {
  formatPrice,
  rowPriceLabel,
  priceRangeLabel,
  priceAdderLabel,
  formatDuration,
  serviceTypeLabel,
  filterServices,
  sortServices,
  sortChecklists,
} from "./deriveServices";

const svc = (over: Partial<{
  id: string; name: string; description: string | null; base_price: number;
  duration_minutes: number; service_type: string; is_active: boolean; updated_at: string;
}> = {}) => ({
  id: "1", name: "Standard Clean", description: "A clean", base_price: 120,
  duration_minutes: 90, service_type: "regular", is_active: true,
  updated_at: "2026-06-01T00:00:00Z", ...over,
});

describe("formatPrice", () => {
  it("drops decimals for integers", () => expect(formatPrice(120)).toBe("$120"));
  it("keeps two decimals for non-integers", () => expect(formatPrice(120.5)).toBe("$120.50"));
  it("adds thousands separators", () => expect(formatPrice(1200)).toBe("$1,200"));
});

describe("rowPriceLabel / priceRangeLabel", () => {
  it("shows base alone with no add-on", () => {
    expect(rowPriceLabel(120, 0)).toBe("$120");
    expect(priceRangeLabel(120, 0)).toBe("$120");
  });
  it("shows a + in the row and a 'to' range in detail when add-ons exist", () => {
    expect(rowPriceLabel(120, 40)).toBe("$120+");
    expect(priceRangeLabel(120, 40)).toBe("$120 to $160");
  });
  it("never uses a dash in the range", () => {
    expect(priceRangeLabel(120, 40)).not.toContain("-");
    expect(priceRangeLabel(120, 40)).not.toContain("—");
  });
});

describe("priceAdderLabel", () => {
  it("formats positive adders", () => expect(priceAdderLabel(20)).toBe("+$20"));
  it("formats a zero adder", () => expect(priceAdderLabel(0)).toBe("+$0"));
});

describe("formatDuration", () => {
  it("minutes under an hour", () => expect(formatDuration(45)).toBe("45m"));
  it("whole hours", () => expect(formatDuration(120)).toBe("2h"));
  it("hours and minutes", () => expect(formatDuration(90)).toBe("1h 30m"));
});

describe("serviceTypeLabel", () => {
  it("title-cases and de-underscores", () => {
    expect(serviceTypeLabel("move_out")).toBe("Move Out");
    expect(serviceTypeLabel("regular")).toBe("Regular");
  });
});

describe("filterServices", () => {
  const list = [
    svc({ id: "a", name: "Standard Clean", is_active: true, service_type: "regular" }),
    svc({ id: "b", name: "Deep Clean", is_active: false, service_type: "deep" }),
  ];
  it("filters by status active/inactive/all", () => {
    expect(filterServices(list, { search: "", status: "active" }).map((s) => s.id)).toEqual(["a"]);
    expect(filterServices(list, { search: "", status: "inactive" }).map((s) => s.id)).toEqual(["b"]);
    expect(filterServices(list, { search: "", status: "all" }).map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("free-text matches name/type/description", () => {
    expect(filterServices(list, { search: "deep", status: "all" }).map((s) => s.id)).toEqual(["b"]);
  });
  it("returns a new array", () => {
    expect(filterServices(list, { search: "", status: "all" })).not.toBe(list);
  });
});

describe("sortServices", () => {
  const list = [
    svc({ id: "a", name: "Bravo", base_price: 200, updated_at: "2026-06-01T00:00:00Z" }),
    svc({ id: "b", name: "Alpha", base_price: 100, updated_at: "2026-06-10T00:00:00Z" }),
  ];
  it("name A to Z", () => expect(sortServices(list, "name").map((s) => s.id)).toEqual(["b", "a"]));
  it("recent = newest updated first", () => expect(sortServices(list, "recent").map((s) => s.id)).toEqual(["b", "a"]));
  it("price low to high", () => expect(sortServices(list, "price").map((s) => s.id)).toEqual(["b", "a"]));
});

describe("sortChecklists", () => {
  it("orders by position (nulls last) then name", () => {
    const cls = [
      { id: "1", name: "Zeta", position: null },
      { id: "2", name: "Beta", position: 1 },
      { id: "3", name: "Alpha", position: 0 },
    ];
    expect(sortChecklists(cls).map((c) => c.id)).toEqual(["3", "2", "1"]);
  });
});
