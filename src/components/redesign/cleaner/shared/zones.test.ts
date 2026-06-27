import { describe, it, expect } from "vitest";
import { isUpcomingZone, isUnfinished, isNeedsAttention, isPastZone } from "./zones";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const TODAY = "2026-06-10", GRACE = "2026-06-07"; // today - 3 days
const a = (over: Partial<CleanerAppointment>) =>
  ({ status: "confirmed", cleaner_confirmation_status: "approved", scheduled_date: TODAY, scheduled_time: "09:00:00", ...over }) as CleanerAppointment;

describe("isUpcomingZone", () => {
  it("today/future committed-or-pending jobs", () => {
    expect(isUpcomingZone(a({ scheduled_date: TODAY }), TODAY)).toBe(true);
    expect(isUpcomingZone(a({ scheduled_date: "2026-06-20" }), TODAY)).toBe(true);
    expect(isUpcomingZone(a({ scheduled_date: "2026-06-09" }), TODAY)).toBe(false); // past
    expect(isUpcomingZone(a({ status: "completed" }), TODAY)).toBe(false);
  });
});

describe("isUnfinished / isNeedsAttention / isPastZone", () => {
  it("unfinished = confirmed|in_progress dated before today", () => {
    expect(isUnfinished(a({ scheduled_date: "2026-06-09" }), TODAY)).toBe(true);
    expect(isUnfinished(a({ status: "in_progress", scheduled_date: "2026-06-08" }), TODAY)).toBe(true);
    expect(isUnfinished(a({ scheduled_date: TODAY }), TODAY)).toBe(false);
    expect(isUnfinished(a({ status: "cancelled", scheduled_date: "2026-06-09" }), TODAY)).toBe(false);
  });
  it("needs-attention only within the grace window (boundary: 3 days in, 4 days out)", () => {
    expect(isNeedsAttention(a({ scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(true);  // yesterday
    expect(isNeedsAttention(a({ scheduled_date: "2026-06-07" }), TODAY, GRACE)).toBe(true);  // exactly 3 days
    expect(isNeedsAttention(a({ scheduled_date: "2026-06-06" }), TODAY, GRACE)).toBe(false); // 4 days -> aged out
  });
  it("past zone is the complement (catches done/cancelled/aged/expired, never upcoming/needs-attention)", () => {
    expect(isPastZone(a({ status: "completed" }), TODAY, GRACE)).toBe(true);
    expect(isPastZone(a({ status: "cancelled", scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(true);
    expect(isPastZone(a({ scheduled_date: "2026-06-06" }), TODAY, GRACE)).toBe(true);   // aged unfinished
    expect(isPastZone(a({ status: "pending", cleaner_confirmation_status: "awaiting", scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(true); // expired offer
    expect(isPastZone(a({ scheduled_date: TODAY }), TODAY, GRACE)).toBe(false);        // upcoming
    expect(isPastZone(a({ scheduled_date: "2026-06-09" }), TODAY, GRACE)).toBe(false); // needs attention
  });
});
