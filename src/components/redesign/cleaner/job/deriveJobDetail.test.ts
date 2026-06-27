import { describe, it, expect } from "vitest";
import { deriveJobActionMode, offeredSlots } from "./deriveJobDetail";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const a = (over: Partial<CleanerAppointment>) =>
  ({ id: "j1", scheduled_date: "2026-06-01", scheduled_time: "09:00:00", status: "confirmed", cleaner_confirmation_status: "approved", ...over }) as CleanerAppointment;

describe("deriveJobActionMode", () => {
  it("offer when pending+awaiting", () => expect(deriveJobActionMode(a({ status: "pending", cleaner_confirmation_status: "awaiting" }))).toBe("offer"));
  it("start when confirmed", () => expect(deriveJobActionMode(a({ status: "confirmed" }))).toBe("start"));
  it("continue when in_progress", () => expect(deriveJobActionMode(a({ status: "in_progress" }))).toBe("continue"));
  it("done when completed", () => expect(deriveJobActionMode(a({ status: "completed" }))).toBe("done"));
  it("none for cancelled / non-awaiting pending", () => {
    expect(deriveJobActionMode(a({ status: "cancelled" }))).toBe("none");
    expect(deriveJobActionMode(a({ status: "pending", cleaner_confirmation_status: "approved" }))).toBe("none");
  });
});

describe("offeredSlots", () => {
  it("sorts requested slots by index", () => {
    const slots = offeredSlots(a({ requested_slots: [
      { slot_index: 2, scheduled_date: "2026-06-03", scheduled_time: "10:00:00" },
      { slot_index: 0, scheduled_date: "2026-06-01", scheduled_time: "09:00:00" },
    ] } as Partial<CleanerAppointment>));
    expect(slots.map((s) => s.slot_index)).toEqual([0, 2]);
  });
  it("synthesizes a primary slot when none are attached", () => {
    expect(offeredSlots(a({}))).toEqual([{ slot_index: 0, scheduled_date: "2026-06-01", scheduled_time: "09:00:00" }]);
  });
});
