import { describe, expect, it } from "vitest";
import { deriveToday } from "./deriveToday";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const TODAY = "2026-06-26";
const TOMORROW = "2026-06-27";
const GRACE = "2026-06-23"; // TODAY - 3 days

function appt(over: Partial<CleanerAppointment>): CleanerAppointment {
  return {
    id: Math.random().toString(36).slice(2),
    scheduled_date: TODAY,
    scheduled_time: "10:00:00",
    status: "confirmed",
    total_price: 100,
    cleaner_confirmation_status: "approved",
    homeowner: null,
    property: null,
    service_type: null,
    ...over,
  } as CleanerAppointment;
}

describe("deriveToday", () => {
  it("pins the first in-progress job as active", () => {
    const r = deriveToday(
      [appt({ id: "a", status: "in_progress" }), appt({ id: "b" })],
      TODAY, TOMORROW, GRACE, "percentage_contractor"
    );
    expect(r.activeJob?.id).toBe("a");
  });

  it("surfaces awaiting offers in the contractor model, sorted by time", () => {
    const r = deriveToday(
      [
        appt({ id: "late", status: "pending", cleaner_confirmation_status: "awaiting", scheduled_time: "15:00:00" }),
        appt({ id: "early", status: "pending", cleaner_confirmation_status: "awaiting", scheduled_time: "09:00:00" }),
      ],
      TODAY, TOMORROW, GRACE, "percentage_contractor"
    );
    expect(r.offers.map((o) => o.id)).toEqual(["early", "late"]);
  });

  it("hides offers entirely in the employee model", () => {
    const r = deriveToday(
      [appt({ status: "pending", cleaner_confirmation_status: "awaiting" })],
      TODAY, TOMORROW, GRACE, "hourly_external"
    );
    expect(r.offers).toHaveLength(0);
  });

  it("flags isEmployee from the payout model", () => {
    expect(deriveToday([], TODAY, TOMORROW, GRACE, "percentage_contractor").isEmployee).toBe(false);
    expect(deriveToday([], TODAY, TOMORROW, GRACE, "hourly_external").isEmployee).toBe(true);
  });

  it("lists today's confirmed jobs sorted by time (excludes completed); earliest lifts to nextUp", () => {
    const r = deriveToday(
      [
        appt({ id: "pm", scheduled_time: "16:30:00" }),
        appt({ id: "am", scheduled_time: "08:00:00" }),
        appt({ id: "done", status: "completed", scheduled_time: "07:00:00" }),
      ],
      TODAY, TOMORROW, GRACE, "percentage_contractor"
    );
    expect(r.nextUp?.id).toBe("am");
    expect(r.todayJobs.map((j) => j.id)).toEqual(["pm"]);
  });

  it("counts tomorrow's jobs and finds the earliest start", () => {
    const r = deriveToday(
      [
        appt({ scheduled_date: TOMORROW, scheduled_time: "13:00:00" }),
        appt({ scheduled_date: TOMORROW, scheduled_time: "09:00:00" }),
      ],
      TODAY, TOMORROW, GRACE, "percentage_contractor"
    );
    expect(r.tomorrowCount).toBe(2);
    expect(r.tomorrowFirstTime).toBe("09:00:00");
  });

  it("reports empty when nothing is actionable", () => {
    const r = deriveToday([], TODAY, TOMORROW, GRACE, "percentage_contractor");
    expect(r.isEmpty).toBe(true);
  });

  it("routes overdue confirmed + stale in-progress to needsAttention (not active/today)", () => {
    const r = deriveToday(
      [
        appt({ id: "stale", status: "in_progress", scheduled_date: "2026-06-25" }), // yesterday, started, never finished
        appt({ id: "overdue", status: "confirmed", scheduled_date: "2026-06-24" }), // 2 days ago, never started
        appt({ id: "today", status: "confirmed", scheduled_date: TODAY }),
      ],
      TODAY, TOMORROW, GRACE, "percentage_contractor"
    );
    expect(r.activeJob).toBeNull();
    expect(r.needsAttention.map((j) => j.id).sort()).toEqual(["overdue", "stale"]);
    expect(r.nextUp?.id).toBe("today");
    expect(r.todayJobs).toHaveLength(0);
    expect(r.isEmpty).toBe(false);
  });

  it("an in-progress job scheduled today still pins as active and is not double-listed in todayJobs", () => {
    const r = deriveToday(
      [appt({ id: "live", status: "in_progress", scheduled_date: TODAY })],
      TODAY, TOMORROW, GRACE, "percentage_contractor"
    );
    expect(r.activeJob?.id).toBe("live");
    expect(r.needsAttention).toHaveLength(0);
    expect(r.nextUp).toBeNull();
    expect(r.todayJobs).toHaveLength(0);
  });

  describe("nextUp (one-tap Start card)", () => {
    it("lifts the earliest confirmed today job into nextUp and drops it from todayJobs", () => {
      const r = deriveToday(
        [
          appt({ id: "late", scheduled_time: "14:00:00" }),
          appt({ id: "early", scheduled_time: "09:00:00" }),
          appt({ id: "mid", scheduled_time: "11:00:00" }),
        ],
        TODAY, TOMORROW, GRACE, "percentage_contractor"
      );
      expect(r.nextUp?.id).toBe("early");
      expect(r.todayJobs.map((j) => j.id)).toEqual(["mid", "late"]);
    });

    it("with no clock reference, does not surface next up while a job is active", () => {
      const r = deriveToday(
        [
          appt({ id: "active", status: "in_progress", scheduled_date: TODAY }),
          appt({ id: "t1", scheduled_time: "09:00:00" }),
          appt({ id: "t2", scheduled_time: "13:00:00" }),
        ],
        TODAY, TOMORROW, GRACE, "percentage_contractor"
      );
      expect(r.activeJob?.id).toBe("active");
      expect(r.nextUp).toBeNull();
      expect(r.todayJobs.map((j) => j.id)).toEqual(["t1", "t2"]);
    });

    it("while active, surfaces the soon-starting job below and pulls it from the list", () => {
      const r = deriveToday(
        [
          appt({ id: "active", status: "in_progress", scheduled_date: TODAY }),
          appt({ id: "soon", scheduled_time: "10:00:00" }), // 120 min out, within 180
          appt({ id: "late", scheduled_time: "17:00:00" }), // 540 min out, beyond
        ],
        TODAY, TOMORROW, GRACE, "percentage_contractor",
        8 * 60 // now = 08:00
      );
      expect(r.activeJob?.id).toBe("active");
      expect(r.nextUp?.id).toBe("soon");
      expect(r.todayJobs.map((j) => j.id)).toEqual(["late"]);
    });

    it("while active, does not surface a job beyond the window", () => {
      const r = deriveToday(
        [
          appt({ id: "active", status: "in_progress", scheduled_date: TODAY }),
          appt({ id: "far", scheduled_time: "17:00:00" }),
        ],
        TODAY, TOMORROW, GRACE, "percentage_contractor",
        8 * 60 // now = 08:00, far is 540 min out
      );
      expect(r.nextUp).toBeNull();
      expect(r.todayJobs.map((j) => j.id)).toEqual(["far"]);
    });

    it("while active, ignores a job whose start has already passed", () => {
      const r = deriveToday(
        [
          appt({ id: "active", status: "in_progress", scheduled_date: TODAY }),
          appt({ id: "past", scheduled_time: "07:00:00" }),
        ],
        TODAY, TOMORROW, GRACE, "percentage_contractor",
        9 * 60 // now = 09:00, past is -120 min
      );
      expect(r.nextUp).toBeNull();
      expect(r.todayJobs.map((j) => j.id)).toEqual(["past"]);
    });

    it("is null when nothing is confirmed for today", () => {
      const r = deriveToday(
        [appt({ scheduled_date: TOMORROW })],
        TODAY, TOMORROW, GRACE, "percentage_contractor"
      );
      expect(r.nextUp).toBeNull();
    });

    it("makes a lone confirmed today job the nextUp with an empty today list", () => {
      const r = deriveToday(
        [appt({ id: "only", scheduled_time: "10:00:00" })],
        TODAY, TOMORROW, GRACE, "percentage_contractor"
      );
      expect(r.nextUp?.id).toBe("only");
      expect(r.todayJobs).toHaveLength(0);
      // The lifted job is still real work, so the day is not empty.
      expect(r.isEmpty).toBe(false);
    });
  });
});
