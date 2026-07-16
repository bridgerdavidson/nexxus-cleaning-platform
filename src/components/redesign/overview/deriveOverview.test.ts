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
  const NOW = Date.parse("2026-06-19T12:00:00Z");

  it("classifies unassigned (no cleaner, not cancelled)", () => {
    const r = deriveOverviewSections([appt({ cleaner_id: null })], today, NOW);
    expect(r.unassigned).toHaveLength(1);
  });

  it("excludes cancelled from unassigned", () => {
    const r = deriveOverviewSections([appt({ cleaner_id: null, status: "cancelled" })], today, NOW);
    expect(r.unassigned).toHaveLength(0);
  });

  it("lists a fully-declined booking (no cleaner + rejected) only under declined, not unassigned too", () => {
    const r = deriveOverviewSections(
      [appt({ cleaner_id: null, cleaner_confirmation_status: "rejected" })],
      today,
      NOW
    );
    expect(r.declined).toHaveLength(1);
    expect(r.unassigned).toHaveLength(0);
  });

  it("classifies declined and counter-proposed", () => {
    const r = deriveOverviewSections(
      [
        appt({ cleaner_id: "c1", cleaner_confirmation_status: "rejected" }),
        appt({ cleaner_id: "c1", cleaner_availability_feedback: [{ at: "x" }] }),
      ],
      today,
      NOW
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
      today,
      NOW
    );
    expect(r.today).toHaveLength(2);
    expect(r.activeNow).toHaveLength(1);
  });

  it("guards a null counter-proposal array", () => {
    const r = deriveOverviewSections([appt({ cleaner_availability_feedback: null })], today, NOW);
    expect(r.counterProposed).toHaveLength(0);
  });

  describe("failedPayment (charge failed or needs authentication)", () => {
    it("includes completed jobs with a failed or requires_action charge", () => {
      const r = deriveOverviewSections(
        [
          appt({ cleaner_id: "c1", status: "completed", authorization_status: "failed" }),
          appt({ cleaner_id: "c1", status: "completed", authorization_status: "requires_action" }),
        ],
        today,
        NOW
      );
      expect(r.failedPayment).toHaveLength(2);
    });

    it("excludes cancelled rows and non-failure statuses", () => {
      const r = deriveOverviewSections(
        [
          appt({ cleaner_id: "c1", status: "cancelled", authorization_status: "failed" }),
          appt({ cleaner_id: "c1", status: "completed", authorization_status: "captured" }),
          appt({ cleaner_id: "c1", status: "completed", authorization_status: "charging" }),
          appt({ cleaner_id: "c1", status: "completed", authorization_status: null }),
          appt({ cleaner_id: "c1", status: "completed" }), // column absent entirely
        ],
        today,
        NOW
      );
      expect(r.failedPayment).toHaveLength(0);
    });
  });

  describe("overdue (cleaner response deadline passed)", () => {
    const asked = (over: Partial<OverviewAppointment> = {}) =>
      appt({ cleaner_id: "c1", cleaner_confirmation_status: "awaiting", ...over });

    it("includes a pending booking whose deadline has passed unanswered", () => {
      const r = deriveOverviewSections([asked({ response_deadline: "2026-06-19T10:00:00Z" })], today, NOW);
      expect(r.overdue).toHaveLength(1);
    });

    it("excludes a deadline still in the future", () => {
      const r = deriveOverviewSections([asked({ response_deadline: "2026-06-19T14:00:00Z" })], today, NOW);
      expect(r.overdue).toHaveLength(0);
    });

    it("excludes bookings with no deadline set", () => {
      const r = deriveOverviewSections([asked({ response_deadline: null }), asked({})], today, NOW);
      expect(r.overdue).toHaveLength(0);
    });

    it("excludes answered, resolved, unassigned, and cancelled rows", () => {
      const past = "2026-06-19T10:00:00Z";
      const r = deriveOverviewSections(
        [
          asked({ response_deadline: past, cleaner_confirmation_status: "approved" }),
          asked({ response_deadline: past, cleaner_confirmation_status: "rejected" }), // declined bucket's job
          asked({ response_deadline: past, status: "confirmed" }),
          asked({ response_deadline: past, status: "cancelled" }),
          appt({ cleaner_id: null, response_deadline: past }), // unassigned bucket's job
        ],
        today,
        NOW
      );
      expect(r.overdue).toHaveLength(0);
    });
  });
});
