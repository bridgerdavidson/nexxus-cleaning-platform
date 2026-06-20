import { describe, expect, it } from "vitest";
import { deriveOverviewSections, type OverviewAppointment } from "./deriveOverview";

const appt = (over: Partial<OverviewAppointment> = {}): OverviewAppointment => ({
  status: "pending",
  cleaner_id: null,
  cleaner_confirmation_status: "awaiting",
  scheduled_date: "2026-06-19",
  cleaner_availability_feedback: [],
  response_deadline: null,
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
        appt({ cleaner_id: "c1", cleaner_confirmation_status: "rejected", cleaner_availability_feedback: [{ at: "x" }] }),
      ],
      today
    );
    expect(r.declined).toHaveLength(1);
    expect(r.counterProposed).toHaveLength(1);
  });

  it("does not double-count a counter-proposal as declined", () => {
    // A counter-proposal is a rejection WITH suggested times. It must land in
    // counterProposed only, never also in declined.
    const r = deriveOverviewSections(
      [appt({ cleaner_id: "c1", cleaner_confirmation_status: "rejected", cleaner_availability_feedback: [{ at: "x" }] })],
      today
    );
    expect(r.counterProposed).toHaveLength(1);
    expect(r.declined).toHaveLength(0);
  });

  it("does not also count an all-cleaners-declined item as unassigned", () => {
    // Rejected with no cleaner left (chain exhausted) is "declined" (force-assign),
    // not "unassigned" — the two buckets must stay disjoint.
    const r = deriveOverviewSections(
      [appt({ cleaner_id: null, cleaner_confirmation_status: "rejected" })],
      today
    );
    expect(r.declined).toHaveLength(1);
    expect(r.unassigned).toHaveLength(0);
  });

  it("surfaces an overdue cleaner response and keeps it out of other buckets", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const overdue = appt({
      cleaner_id: "c1",
      cleaner_confirmation_status: "awaiting",
      response_deadline: "2026-06-19T10:00:00Z", // 2h before now
    });
    const r = deriveOverviewSections([overdue], today, now);
    expect(r.overdue).toHaveLength(1);
    expect(r.unassigned).toHaveLength(0);
    expect(r.declined).toHaveLength(0);
    expect(r.counterProposed).toHaveLength(0);
  });

  it("does not flag an awaiting response before its deadline as overdue", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const r = deriveOverviewSections(
      [appt({ cleaner_id: "c1", cleaner_confirmation_status: "awaiting", response_deadline: "2026-06-19T14:00:00Z" })],
      today,
      now
    );
    expect(r.overdue).toHaveLength(0);
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
