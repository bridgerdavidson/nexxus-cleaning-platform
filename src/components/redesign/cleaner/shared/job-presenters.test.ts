import { describe, it, expect } from "vitest";
import {
  formatTimeParts, propertyTitle, jobSubtitle, formatRespondBy,
  customerLabel, propertyAddress, mapsUrl, formatDateLong, formatDuration,
} from "./job-presenters";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const base = {
  id: "a1", scheduled_date: "2026-06-01", scheduled_time: "09:00:00", status: "confirmed",
  cleaner_confirmation_status: "approved", total_price: 120,
  property: { name: "Maple House", address: "123 Main St", city: "Austin", state: "TX", zip_code: "78701" },
  homeowner: { first_name: "Jamie", last_name: "Lee", email: "j@x.co" },
  service_type: { name: "Deep clean", description: "", duration_minutes: 150 },
} as unknown as CleanerAppointment;

describe("formatTimeParts", () => {
  it("formats 24h to 12h parts", () => {
    expect(formatTimeParts("09:00:00")).toEqual({ h: "9:00", ap: "AM" });
    expect(formatTimeParts("13:30:00")).toEqual({ h: "1:30", ap: "PM" });
    expect(formatTimeParts("00:05:00")).toEqual({ h: "12:05", ap: "AM" });
  });
});

describe("propertyTitle / jobSubtitle / customerLabel", () => {
  it("prefers property name, falls back to address then Job", () => {
    expect(propertyTitle(base)).toBe("Maple House");
    expect(propertyTitle({ ...base, property: { ...base.property!, name: "" } } as CleanerAppointment)).toBe("123 Main St");
    expect(propertyTitle({ ...base, property: null } as unknown as CleanerAppointment)).toBe("Job");
  });
  it("joins service and customer with a middot", () => {
    expect(jobSubtitle(base)).toBe("Deep clean · Jamie Lee");
  });
  it("labels a self-pay (no homeowner) job as a company booking", () => {
    expect(customerLabel(base)).toBe("Jamie Lee");
    expect(customerLabel({ ...base, homeowner: null } as unknown as CleanerAppointment)).toBe("Company booking");
  });
});

describe("propertyAddress / mapsUrl", () => {
  it("builds a single-line address", () => {
    expect(propertyAddress(base)).toBe("123 Main St, Austin, TX 78701");
    expect(propertyAddress({ ...base, property: null } as unknown as CleanerAppointment)).toBeNull();
  });
  it("builds a maps search url or null", () => {
    expect(mapsUrl(base)).toBe("https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Austin%2C%20TX%2078701");
    expect(mapsUrl({ ...base, property: null } as unknown as CleanerAppointment)).toBeNull();
  });
});

describe("formatRespondBy", () => {
  it("returns null on missing/invalid deadline", () => {
    expect(formatRespondBy(null)).toBeNull();
    expect(formatRespondBy("not-a-date")).toBeNull();
  });
  it("prefixes 'Respond by'", () => {
    expect(formatRespondBy("2026-06-01T21:00:00Z")).toMatch(/^Respond by /);
  });
});

describe("formatDateLong / formatDuration", () => {
  it("formats an ISO date as a long local date", () => {
    expect(formatDateLong("2026-06-01")).toBe("Monday, June 1, 2026");
  });
  it("formats minutes as h/m", () => {
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(null)).toBeNull();
  });
});
