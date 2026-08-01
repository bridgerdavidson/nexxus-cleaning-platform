import { describe, it, expect } from "vitest";
import type { CleanerAppointment } from "@/hooks/useCleanerData";
import { deriveSeriesOffers } from "./deriveSeriesOffers";

function offer(p: Partial<CleanerAppointment> & { id: string }): CleanerAppointment {
  return {
    scheduled_date: "2026-07-20",
    scheduled_time: "10:00",
    status: "pending",
    cleaner_confirmation_status: "awaiting",
    homeowner: { first_name: "John", last_name: "Doe", email: "j@x.com" },
    property: { name: "Maple", address: "1 A St", city: "Reno", state: "NV", zip_code: "89501" },
    service_type: { name: "Regular Cleaning", description: "", duration_minutes: 120 },
    ...p,
  } as CleanerAppointment;
}

describe("deriveSeriesOffers", () => {
  it("keeps a non-series offer as a single", () => {
    const g = deriveSeriesOffers([offer({ id: "a" })]);
    expect(g.singles.map((s) => s.id)).toEqual(["a"]);
    expect(g.series).toHaveLength(0);
  });

  it("groups >= 2 occurrences sharing a series_id and sorts them by date", () => {
    const g = deriveSeriesOffers([
      offer({ id: "b2", series_id: "S1", scheduled_date: "2026-07-27" }),
      offer({ id: "b1", series_id: "S1", scheduled_date: "2026-07-20" }),
    ]);
    expect(g.singles).toHaveLength(0);
    expect(g.series).toHaveLength(1);
    const s = g.series[0];
    expect(s.seriesId).toBe("S1");
    expect(s.count).toBe(2);
    expect(s.occurrences.map((o) => o.id)).toEqual(["b1", "b2"]);
    expect(s.first.id).toBe("b1");
    expect(s.startDate).toBe("2026-07-20");
    expect(s.endDate).toBe("2026-07-27");
  });

  it("degrades a lone remaining series occurrence to a single", () => {
    const g = deriveSeriesOffers([offer({ id: "c", series_id: "S9" })]);
    expect(g.series).toHaveLength(0);
    expect(g.singles.map((s) => s.id)).toEqual(["c"]);
  });

  it("computes the soonest non-null deadline across the group", () => {
    const g = deriveSeriesOffers([
      offer({ id: "d1", series_id: "S1", scheduled_date: "2026-07-20", response_deadline: "2026-07-19T18:00:00.000Z" }),
      offer({ id: "d2", series_id: "S1", scheduled_date: "2026-07-27", response_deadline: "2026-07-26T18:00:00.000Z" }),
      offer({ id: "d3", series_id: "S1", scheduled_date: "2026-08-03", response_deadline: null }),
    ]);
    expect(g.series[0].soonestDeadline).toBe("2026-07-19T18:00:00.000Z");
  });

  it("sorts multiple series by their start date and separates singles", () => {
    const g = deriveSeriesOffers([
      offer({ id: "late1", series_id: "LATE", scheduled_date: "2026-09-01" }),
      offer({ id: "late2", series_id: "LATE", scheduled_date: "2026-09-08" }),
      offer({ id: "single", scheduled_date: "2026-07-15" }),
      offer({ id: "early1", series_id: "EARLY", scheduled_date: "2026-07-20" }),
      offer({ id: "early2", series_id: "EARLY", scheduled_date: "2026-07-27" }),
    ]);
    expect(g.singles.map((s) => s.id)).toEqual(["single"]);
    expect(g.series.map((s) => s.seriesId)).toEqual(["EARLY", "LATE"]);
  });
});
