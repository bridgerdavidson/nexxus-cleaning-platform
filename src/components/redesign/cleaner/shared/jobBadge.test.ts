import { describe, it, expect } from "vitest";
import { jobBadgeKey } from "./jobBadge";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const a = (over: Partial<CleanerAppointment>) => ({ status: "confirmed", cleaner_confirmation_status: "approved", ...over }) as CleanerAppointment;

describe("jobBadgeKey", () => {
  it("maps cancelled/completed/in_progress first", () => {
    expect(jobBadgeKey(a({ status: "cancelled" }))).toBe("cancelled");
    expect(jobBadgeKey(a({ status: "completed" }))).toBe("completed");
    expect(jobBadgeKey(a({ status: "in_progress" }))).toBe("in_progress");
  });
  it("maps an awaiting pending offer to needs_response", () => {
    expect(jobBadgeKey(a({ status: "pending", cleaner_confirmation_status: "awaiting" }))).toBe("needs_response");
  });
  it("defaults to upcoming", () => {
    expect(jobBadgeKey(a({ status: "confirmed" }))).toBe("upcoming");
    expect(jobBadgeKey(a({ status: "pending", cleaner_confirmation_status: "approved" }))).toBe("upcoming");
  });
});

describe("jobBadgeKey zone-awareness (todayStr given)", () => {
  const PAST = "2026-06-05";
  it("stale confirmed/in_progress -> unfinished", () => {
    expect(jobBadgeKey(a({ status: "confirmed", scheduled_date: PAST }), "2026-06-10")).toBe("unfinished");
    expect(jobBadgeKey(a({ status: "in_progress", scheduled_date: PAST }), "2026-06-10")).toBe("unfinished");
  });
  it("stale pending -> expired", () => {
    expect(jobBadgeKey(a({ status: "pending", cleaner_confirmation_status: "awaiting", scheduled_date: PAST }), "2026-06-10")).toBe("expired");
  });
  it("without todayStr, falls back to status-only mapping", () => {
    expect(jobBadgeKey(a({ status: "confirmed", scheduled_date: PAST }))).toBe("upcoming");
  });
});
