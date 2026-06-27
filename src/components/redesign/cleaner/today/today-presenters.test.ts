import { describe, expect, it } from "vitest";
import { formatTimeParts, propertyTitle, jobSubtitle, statusBadge } from "./today-presenters";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const base = {
  id: "x", scheduled_date: "2026-06-26", scheduled_time: "14:30:00",
  status: "confirmed", total_price: 100, cleaner_confirmation_status: "approved",
  homeowner: null, property: null, service_type: null,
} as CleanerAppointment;

describe("today-presenters", () => {
  it("formats 24h time into 12h parts", () => {
    expect(formatTimeParts("14:30:00")).toEqual({ h: "2:30", ap: "PM" });
    expect(formatTimeParts("09:00:00")).toEqual({ h: "9:00", ap: "AM" });
    expect(formatTimeParts("00:15:00")).toEqual({ h: "12:15", ap: "AM" });
  });

  it("titles by property name, then address, then a fallback", () => {
    expect(propertyTitle({ ...base, property: { name: "Oak House", address: "1 A St", city: "", state: "", zip_code: "" } })).toBe("Oak House");
    expect(propertyTitle({ ...base, property: { name: "", address: "123 Oak Street", city: "", state: "", zip_code: "" } })).toBe("123 Oak Street");
    expect(propertyTitle(base)).toBe("Job");
  });

  it("builds a subtitle from service and customer", () => {
    expect(jobSubtitle({ ...base, service_type: { name: "Standard Clean", description: "", duration_minutes: 120 }, homeowner: { first_name: "Sarah", last_name: "M", email: "" } })).toBe("Standard Clean · Sarah M");
  });

  it("maps status to a badge tone", () => {
    expect(statusBadge({ ...base, status: "in_progress" }).tone).toBe("blue");
    expect(statusBadge({ ...base, status: "pending", cleaner_confirmation_status: "awaiting" }).tone).toBe("amber");
    expect(statusBadge({ ...base, status: "completed" }).tone).toBe("green");
    expect(statusBadge({ ...base, status: "confirmed" }).tone).toBe("gray");
  });
});
