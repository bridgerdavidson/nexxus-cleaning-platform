import { describe, it, expect } from "vitest";
import { paymentsKpiItems } from "./paymentsKpis";

describe("paymentsKpiItems", () => {
  it("returns the two headline money tiles, this month first", () => {
    const items = paymentsKpiItems({ totalRevenue: 6669, thisMonth: 816 });
    expect(items.map((i) => i.label)).toEqual(["Revenue this month", "Total revenue"]);
    expect(items[0].value).toContain("816");
    expect(items[1].value).toContain("6,669");
  });
});
