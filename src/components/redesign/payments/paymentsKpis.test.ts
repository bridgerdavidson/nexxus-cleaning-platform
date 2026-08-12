import { describe, it, expect } from "vitest";
import { paymentsKpiItems } from "./paymentsKpis";

describe("paymentsKpiItems", () => {
  it("returns the two headline money tiles, this month first", () => {
    const items = paymentsKpiItems({ totalRevenueCents: 666900, thisMonthCents: 81600 });
    expect(items.map((i) => i.label)).toEqual(["Revenue this month", "Total revenue"]);
    expect(items[0].value).toContain("816");
    expect(items[1].value).toContain("6,669");
  });

  it("renders exact cents, not whole dollars (T2-11)", () => {
    const items = paymentsKpiItems({ totalRevenueCents: 666945, thisMonthCents: 81650 });
    expect(items[0].value).toBe("$816.50");
    expect(items[1].value).toBe("$6,669.45");
  });
});
