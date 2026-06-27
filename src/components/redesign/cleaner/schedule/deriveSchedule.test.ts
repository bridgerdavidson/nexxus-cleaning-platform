import { describe, it, expect } from "vitest";
import { deriveSchedule, scheduleGroupOf, matchesScheduleStatus, matchesScheduleSearch } from "./deriveSchedule";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const TODAY = "2026-06-10", TMRW = "2026-06-11", WEND = "2026-06-16", GRACE = "2026-06-07";
const appt = (over: Partial<CleanerAppointment>) =>
  ({ id: Math.random().toString(36).slice(2), scheduled_date: TODAY, scheduled_time: "09:00:00", status: "confirmed", cleaner_confirmation_status: "approved",
     property: { name: "House", address: "1 A St", city: "Austin", state: "TX", zip_code: "1" }, service_type: { name: "Clean", description: "", duration_minutes: 60 }, homeowner: { first_name: "Sam", last_name: "Roe", email: "" }, ...over }) as unknown as CleanerAppointment;

describe("scheduleGroupOf", () => {
  it("buckets by date", () => {
    expect(scheduleGroupOf(appt({ scheduled_date: TODAY }), TODAY, TMRW, WEND)).toBe("today");
    expect(scheduleGroupOf(appt({ scheduled_date: TMRW }), TODAY, TMRW, WEND)).toBe("tomorrow");
    expect(scheduleGroupOf(appt({ scheduled_date: "2026-06-14" }), TODAY, TMRW, WEND)).toBe("this_week");
    expect(scheduleGroupOf(appt({ scheduled_date: "2026-06-20" }), TODAY, TMRW, WEND)).toBe("later");
    expect(scheduleGroupOf(appt({ scheduled_date: "2026-06-01" }), TODAY, TMRW, WEND)).toBe("today"); // overdue-but-upcoming
  });
});

describe("matchesScheduleStatus / matchesScheduleSearch", () => {
  it("needs_response = pending+awaiting", () => {
    expect(matchesScheduleStatus(appt({ status: "pending", cleaner_confirmation_status: "awaiting" }), "needs_response")).toBe(true);
    expect(matchesScheduleStatus(appt({ status: "confirmed" }), "needs_response")).toBe(false);
  });
  it("search matches property/service/customer", () => {
    expect(matchesScheduleSearch(appt({}), "house")).toBe(true);
    expect(matchesScheduleSearch(appt({}), "sam")).toBe(true);
    expect(matchesScheduleSearch(appt({}), "zzz")).toBe(false);
  });
});

describe("deriveSchedule", () => {
  it("groups upcoming and orders groups", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-20" }), appt({ scheduled_date: TODAY }), appt({ scheduled_date: TMRW })],
      { search: "", statusFilter: "all", view: "upcoming", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND, graceFloorStr: GRACE },
    );
    expect(data.groups.map((g) => g.key)).toEqual(["today", "tomorrow", "later"]);
    expect(data.total).toBe(3);
    expect(data.isEmpty).toBe(false);
  });
  it("past view is a single descending group of completed/cancelled", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-05", status: "completed" }), appt({ scheduled_date: "2026-06-08", status: "cancelled" }), appt({ scheduled_date: TODAY, status: "confirmed" })],
      { search: "", statusFilter: "all", view: "past", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND, graceFloorStr: GRACE },
    );
    expect(data.groups.map((g) => g.key)).toEqual(["past"]);
    expect(data.groups[0].jobs.map((j) => j.scheduled_date)).toEqual(["2026-06-08", "2026-06-05"]);
    expect(data.total).toBe(2);
  });
  it("upcoming excludes completed/cancelled and is empty when none match", () => {
    const data = deriveSchedule([appt({ status: "completed" })], { search: "", statusFilter: "all", view: "upcoming", todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND, graceFloorStr: GRACE });
    expect(data.isEmpty).toBe(true);
    expect(data.groups).toEqual([]);
  });
});

describe("deriveSchedule needs-attention + zones", () => {
  const opts = (view: "upcoming" | "past") => ({
    search: "", statusFilter: "all" as const, view, todayStr: TODAY, tomorrowStr: TMRW, weekEndStr: WEND, graceFloorStr: GRACE,
  });

  it("recent unfinished -> needsAttention, NOT the Today group", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-09", status: "confirmed" }), appt({ scheduled_date: TODAY, status: "confirmed" })],
      opts("upcoming"),
    );
    expect(data.needsAttention.map((j) => j.scheduled_date)).toEqual(["2026-06-09"]);
    expect(data.groups.flatMap((g) => g.jobs).map((j) => j.scheduled_date)).toEqual([TODAY]); // overdue NOT in Today
  });

  it("stale in_progress -> needsAttention, not Upcoming", () => {
    const data = deriveSchedule([appt({ scheduled_date: "2026-06-08", status: "in_progress" })], opts("upcoming"));
    expect(data.needsAttention.length).toBe(1);
    expect(data.groups).toEqual([]);
  });

  it("aged unfinished + completed/cancelled show in Past, not needsAttention", () => {
    const data = deriveSchedule(
      [appt({ scheduled_date: "2026-06-01", status: "confirmed" }), appt({ scheduled_date: "2026-06-08", status: "completed" })],
      opts("past"),
    );
    expect(data.needsAttention).toEqual([]);
    expect(data.groups[0].jobs.length).toBe(2); // aged-unfinished + completed both in Past
  });

  it("needsAttention is shown regardless of the active view (Past)", () => {
    const data = deriveSchedule([appt({ scheduled_date: "2026-06-09", status: "confirmed" })], opts("past"));
    expect(data.needsAttention.length).toBe(1);
  });
});
