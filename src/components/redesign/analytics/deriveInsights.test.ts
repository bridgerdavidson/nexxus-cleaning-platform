import { describe, expect, it } from "vitest";
import { deriveInsights } from "./deriveInsights";
import type { AnalyticsSummary, ServiceMixRow } from "./analytics-types";

const summary = (o: Partial<AnalyticsSummary> = {}): AnalyticsSummary => ({
  revenueCents: 4820000, revenuePrevCents: 4300000, bookedCents: 6100000,
  jobsCompleted: 132, jobsTotal: 140, cancelled: 6, cancelRate: 0.042,
  recurringCents: 2790000, oneoffCents: 2030000, runRateCents: 58100000, forecast30Cents: 5000000,
  arAging: { current: 182000, d1_7: 124000, d8_30: 76000, d30plus: 41000 }, ...o,
});

describe("deriveInsights", () => {
  it("leads with a revenue-up sentence naming the top service", () => {
    const mix: ServiceMixRow[] = [{ serviceTypeId: "1", name: "Deep clean", revenueCents: 520000, jobs: 20, avgTicketCents: 26000 }];
    const out = deriveInsights({ summary: summary(), serviceMix: mix, leaderboard: [], cancellations: { total: 140, cancelled: 6, rate: 0.042, prevRate: 0.05, byReason: [] } });
    expect(out[0].text).toContain("12%");
    expect(out[0].text.toLowerCase()).toContain("deep clean");
  });
  it("emits at most 4 and never throws on empty data", () => {
    const out = deriveInsights({ summary: summary({ revenueCents: null, recurringCents: null, oneoffCents: null }), serviceMix: [], leaderboard: [], cancellations: { total: 0, cancelled: 0, rate: 0, prevRate: 0, byReason: [] } });
    expect(out.length).toBeLessThanOrEqual(4);
  });
});
