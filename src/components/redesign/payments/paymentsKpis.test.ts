import { describe, it, expect } from "vitest";
import { paymentsKpiItems } from "./paymentsKpis";

describe("paymentsKpiItems", () => {
  it("returns the five tiles with formatted values", () => {
    const items = paymentsKpiItems({
      totalRevenue: 6669,
      thisMonth: 816,
      queuedPayouts: 0,
      txnCount: 57,
      payoutCount: 22,
    });
    expect(items.map((i) => i.label)).toEqual([
      "Revenue",
      "This month",
      "Queued payouts",
      "Transactions",
      "Payouts",
    ]);
    expect(items[0].value).toContain("6,669");
    expect(items[3].value).toBe("57");
    expect(items[4].value).toBe("22");
  });
});
