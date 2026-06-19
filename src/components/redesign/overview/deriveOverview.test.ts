import { describe, expect, it } from "vitest";
import { deriveOverviewSections, type OverviewAppointment } from "./deriveOverview";

const appt = (over: Partial<OverviewAppointment> = {}): OverviewAppointment => ({
  status: "pending",
  cleaner_id: null,
  cleaner_confirmation_status: "awaiting",
  scheduled_date: "2026-06-19",
  cleaner_availability_feedback: [],
  ...over,
});

describe("deriveOverviewSections", () => {
  const today = "2026-06-19";

  it("classifies unassigned (no cleaner, not cancelled)", () => {
    const r = deriveOverviewSections([appt({ cleaner_id: null })], today);
    expect(r.unassigned).toHaveLength(1);
  });

  it("excludes cancelled from unassigned", () => {
    const r = deriveOverviewSections([appt({ cleaner_id: null, status: "cancelled" })], today);
    expect(r.unassigned).toHaveLength(0);
  });

  it("classifies declined and counter-proposed", () => {
    const r = deriveOverviewSections(
      [
        appt({ cleaner_id: "c1", cleaner_confirmation_status: "rejected" }),
        appt({ cleaner_id: "c1", cleaner_availability_feedback: [{ at: "x" }] }),
      ],
      today
    );
    expect(r.declined).toHaveLength(1);
    expect(r.counterProposed).toHaveLength(1);
  });

  it("buckets today's schedule and active-now", () => {
    const r = deriveOverviewSections(
      [
        appt({ cleaner_id: "c1", status: "confirmed", scheduled_date: today }),
        appt({ cleaner_id: "c1", status: "in_progress", scheduled_date: today }),
        appt({ cleaner_id: "c1", status: "confirmed", scheduled_date: "2026-07-01" }),
      ],
      today
    );
    expect(r.today).toHaveLength(2);
    expect(r.activeNow).toHaveLength(1);
  });

  it("guards a null counter-proposal array", () => {
    const r = deriveOverviewSections([appt({ cleaner_availability_feedback: null })], today);
    expect(r.counterProposed).toHaveLength(0);
  });
});
