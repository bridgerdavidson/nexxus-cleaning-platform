import { describe, expect, it } from "vitest";
import { deriveToday } from "./deriveToday";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const TODAY = "2026-06-26";
const TOMORROW = "2026-06-27";

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
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.activeJob?.id).toBe("a");
  });

  it("surfaces awaiting offers in the contractor model, sorted by time", () => {
    const r = deriveToday(
      [
        appt({ id: "late", status: "pending", cleaner_confirmation_status: "awaiting", scheduled_time: "15:00:00" }),
        appt({ id: "early", status: "pending", cleaner_confirmation_status: "awaiting", scheduled_time: "09:00:00" }),
      ],
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.offers.map((o) => o.id)).toEqual(["early", "late"]);
  });

  it("hides offers entirely in the employee model", () => {
    const r = deriveToday(
      [appt({ status: "pending", cleaner_confirmation_status: "awaiting" })],
      TODAY, TOMORROW, "hourly_external"
    );
    expect(r.offers).toHaveLength(0);
  });

  it("lists today's confirmed + in-progress jobs sorted by time", () => {
    const r = deriveToday(
      [
        appt({ id: "pm", scheduled_time: "16:30:00" }),
        appt({ id: "am", scheduled_time: "08:00:00" }),
        appt({ id: "done", status: "completed", scheduled_time: "07:00:00" }),
      ],
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.todayJobs.map((j) => j.id)).toEqual(["am", "pm"]);
  });

  it("counts tomorrow's jobs and finds the earliest start", () => {
    const r = deriveToday(
      [
        appt({ scheduled_date: TOMORROW, scheduled_time: "13:00:00" }),
        appt({ scheduled_date: TOMORROW, scheduled_time: "09:00:00" }),
      ],
      TODAY, TOMORROW, "percentage_contractor"
    );
    expect(r.tomorrowCount).toBe(2);
    expect(r.tomorrowFirstTime).toBe("09:00:00");
  });

  it("reports empty when nothing is actionable", () => {
    const r = deriveToday([], TODAY, TOMORROW, "percentage_contractor");
    expect(r.isEmpty).toBe(true);
  });
});
