import { describe, expect, it } from "vitest";
import {
  deriveBookings,
  matchesCleaner,
  matchesSearch,
  matchesSegment,
  matchesStatus,
  segmentCounts,
  type BookingsAppointment,
} from "./deriveBookings";

const today = "2026-06-22";

const appt = (over: Partial<BookingsAppointment> = {}): BookingsAppointment => ({
  status: "pending",
  scheduled_date: today,
  scheduled_time: "10:00",
  cleaner_id: "c1",
  cleaner_profile: { user_profile: { first_name: "Marco", last_name: "Diaz" } },
  homeowner: { first_name: "Jane", last_name: "Smith" },
  property: { address: "123 Maple Ave", city: "Austin", state: "TX" },
  service_type: { name: "Standard Clean" },
  ...over,
});

describe("matchesSegment", () => {
  it("active = in_progress only", () => {
    expect(matchesSegment(appt({ status: "in_progress" }), "active", today)).toBe(true);
    expect(matchesSegment(appt({ status: "confirmed" }), "active", today)).toBe(false);
  });

  it("today = same date and pending/confirmed (excludes in_progress)", () => {
    expect(matchesSegment(appt({ status: "confirmed", scheduled_date: today }), "today", today)).toBe(true);
    expect(matchesSegment(appt({ status: "in_progress", scheduled_date: today }), "today", today)).toBe(false);
    expect(matchesSegment(appt({ status: "completed", scheduled_date: today }), "today", today)).toBe(false);
  });

  it("upcoming = future date and pending/confirmed", () => {
    expect(matchesSegment(appt({ status: "confirmed", scheduled_date: "2026-07-01" }), "upcoming", today)).toBe(true);
    expect(matchesSegment(appt({ status: "confirmed", scheduled_date: today }), "upcoming", today)).toBe(false);
  });

  it("past = completed, cancelled, or an overdue non-active date", () => {
    expect(matchesSegment(appt({ status: "completed" }), "past", today)).toBe(true);
    expect(matchesSegment(appt({ status: "cancelled" }), "past", today)).toBe(true);
    expect(matchesSegment(appt({ status: "pending", scheduled_date: "2026-06-01" }), "past", today)).toBe(true);
    expect(matchesSegment(appt({ status: "in_progress", scheduled_date: "2026-06-01" }), "past", today)).toBe(false);
  });

  it("all = everything", () => {
    expect(matchesSegment(appt({ status: "cancelled" }), "all", today)).toBe(true);
  });
});

describe("matchesSearch", () => {
  it("empty query matches everything", () => {
    expect(matchesSearch(appt(), "")).toBe(true);
  });
  it("matches homeowner, cleaner, address, and service (case-insensitive)", () => {
    expect(matchesSearch(appt(), "jane")).toBe(true);
    expect(matchesSearch(appt(), "MARCO")).toBe(true);
    expect(matchesSearch(appt(), "maple")).toBe(true);
    expect(matchesSearch(appt(), "standard")).toBe(true);
    expect(matchesSearch(appt(), "nonexistent")).toBe(false);
  });
});

describe("matchesStatus", () => {
  it("all passes; otherwise exact match", () => {
    expect(matchesStatus(appt({ status: "completed" }), "all")).toBe(true);
    expect(matchesStatus(appt({ status: "completed" }), "completed")).toBe(true);
    expect(matchesStatus(appt({ status: "pending" }), "completed")).toBe(false);
  });
});

describe("matchesCleaner", () => {
  it("all, unassigned, and specific id", () => {
    expect(matchesCleaner(appt({ cleaner_id: "c1" }), "all")).toBe(true);
    expect(matchesCleaner(appt({ cleaner_id: null }), "unassigned")).toBe(true);
    expect(matchesCleaner(appt({ cleaner_id: "c1" }), "unassigned")).toBe(false);
    expect(matchesCleaner(appt({ cleaner_id: "c1" }), "c1")).toBe(true);
    expect(matchesCleaner(appt({ cleaner_id: "c2" }), "c1")).toBe(false);
  });
});

describe("deriveBookings", () => {
  it("filters by segment + search and sorts upcoming ascending by date/time", () => {
    const list = [
      appt({ scheduled_date: "2026-07-03", scheduled_time: "09:00", status: "confirmed" }),
      appt({ scheduled_date: "2026-07-01", scheduled_time: "14:00", status: "confirmed" }),
      appt({ scheduled_date: "2026-07-01", scheduled_time: "08:00", status: "confirmed" }),
      appt({ status: "completed", scheduled_date: "2026-05-01" }), // not upcoming
    ];
    const out = deriveBookings(list, {
      segment: "upcoming",
      search: "",
      statusFilter: "all",
      cleanerFilter: "all",
      today,
    });
    expect(out).toHaveLength(3);
    expect(out.map((a) => `${a.scheduled_date} ${a.scheduled_time}`)).toEqual([
      "2026-07-01 08:00",
      "2026-07-01 14:00",
      "2026-07-03 09:00",
    ]);
  });

  it("sorts past descending (most recent first)", () => {
    const list = [
      appt({ status: "completed", scheduled_date: "2026-06-10", scheduled_time: "10:00" }),
      appt({ status: "completed", scheduled_date: "2026-06-20", scheduled_time: "10:00" }),
    ];
    const out = deriveBookings(list, {
      segment: "past",
      search: "",
      statusFilter: "all",
      cleanerFilter: "all",
      today,
    });
    expect(out.map((a) => a.scheduled_date)).toEqual(["2026-06-20", "2026-06-10"]);
  });

  it("combines status + cleaner filters", () => {
    const list = [
      appt({ status: "confirmed", cleaner_id: "c1", scheduled_date: "2026-07-01" }),
      appt({ status: "pending", cleaner_id: "c2", scheduled_date: "2026-07-01" }),
    ];
    const out = deriveBookings(list, {
      segment: "upcoming",
      search: "",
      statusFilter: "confirmed",
      cleanerFilter: "c1",
      today,
    });
    expect(out).toHaveLength(1);
    expect(out[0].cleaner_id).toBe("c1");
  });
});

describe("segmentCounts", () => {
  it("counts each segment independently; all = total", () => {
    const list = [
      appt({ status: "in_progress", scheduled_date: today }), // active
      appt({ status: "confirmed", scheduled_date: today }), // today
      appt({ status: "confirmed", scheduled_date: "2026-07-01" }), // upcoming
      appt({ status: "completed", scheduled_date: "2026-06-01" }), // past
      appt({ status: "cancelled", scheduled_date: "2026-07-01" }), // past
    ];
    const c = segmentCounts(list, today);
    expect(c.active).toBe(1);
    expect(c.today).toBe(1);
    expect(c.upcoming).toBe(1);
    expect(c.past).toBe(2);
    expect(c.all).toBe(5);
  });
});
