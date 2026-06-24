import { describe, expect, it } from "vitest";
import { resolveRange, pctDelta, normalizeHeatmap, bucketAging, buildKpis } from "./deriveAnalytics";
import type { AnalyticsSummary, TimeseriesPoint, DemandCell } from "./analytics-types";

const TODAY = new Date("2026-06-23T12:00:00Z");

describe("resolveRange", () => {
  it("30d spans 30 days ending today, prev window is the 30 before, grain=day", () => {
    const r = resolveRange("30d", TODAY);
    expect(r.end).toBe("2026-06-23");
    expect(r.start).toBe("2026-05-25");        // 29 days back inclusive = 30 days
    expect(r.prevEnd).toBe("2026-05-24");
    expect(r.prevStart).toBe("2026-04-25");
    expect(r.grain).toBe("day");
    expect(r.rangeKey).toBe("30d");
  });
  it("12m uses month grain", () => {
    expect(resolveRange("12m", TODAY).grain).toBe("month");
  });
});

describe("pctDelta", () => {
  it("up when current exceeds previous", () => {
    expect(pctDelta(112, 100)).toEqual({ dir: "up", label: "12%", tone: "good" });
  });
  it("flat when previous is 0 and current 0", () => {
    expect(pctDelta(0, 0).dir).toBe("flat");
  });
  it("inverted tone supported for bad-is-up metrics", () => {
    expect(pctDelta(5, 4, { upIsGood: false }).tone).toBe("bad");
  });
});

describe("normalizeHeatmap", () => {
  it("returns 7 rows, scales the busiest cell to 1", () => {
    const cells: DemandCell[] = [{ dow: 1, hour: 10, jobs: 8 }, { dow: 2, hour: 9, jobs: 4 }];
    const rows = normalizeHeatmap(cells);
    expect(rows).toHaveLength(7);
    const peak = rows.flatMap((r) => r.hours).reduce((a, b) => Math.max(a, b), 0);
    expect(peak).toBe(1);
  });
});

describe("bucketAging", () => {
  it("maps the four buckets with tones, dollars from cents", () => {
    const s = { arAging: { current: 182000, d1_7: 124000, d8_30: 76000, d30plus: 41000 } } as AnalyticsSummary;
    const b = bucketAging(s);
    expect(b.map((x) => x.label)).toEqual(["Current", "1-7 days", "8-30 days", "30+ days"]);
    expect(b[0].dollars).toBe(1820);
    expect(b[3].tone).toBe("critical");
  });
  it("returns empty when arAging is null (no money access)", () => {
    expect(bucketAging({ arAging: null } as AnalyticsSummary)).toEqual([]);
  });
});

describe("buildKpis", () => {
  it("hides money KPIs when money=false; emits 2 non-money KPIs", () => {
    const s = { jobsCompleted: 132, jobsTotal: 140, cancelRate: 0.042 } as AnalyticsSummary;
    const kpis = buildKpis(s, [], false);
    expect(kpis.every((k) => !k.money)).toBe(true);
    expect(kpis.find((k) => k.key === "jobs")?.value).toBe("132");
  });
});
