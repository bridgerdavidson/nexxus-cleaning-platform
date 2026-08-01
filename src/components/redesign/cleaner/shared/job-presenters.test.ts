import { describe, it, expect } from "vitest";
import {
  formatTimeParts, propertyTitle, jobSubtitle, formatRespondBy,
  customerLabel, propertyAddress, rowAddressLine, mapsUrl, googleMapsUrl, appleMapsUrl,
  formatDateLong, formatDuration, formatCardDate, formatJobWhen, offerSlotChipLabels,
} from "./job-presenters";
import type { CleanerAppointment } from "@/hooks/useCleanerData";

const base = {
  id: "a1", scheduled_date: "2026-06-01", scheduled_time: "09:00:00", status: "confirmed",
  cleaner_confirmation_status: "approved",
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

describe("rowAddressLine", () => {
  it("shows the street when a distinct property name is the title", () => {
    expect(rowAddressLine(base)).toBe("123 Main St");
  });
  it("returns null when there is no name (propertyTitle already shows the street)", () => {
    expect(rowAddressLine({ ...base, property: { ...base.property!, name: "" } } as CleanerAppointment)).toBeNull();
  });
  it("returns null when there is no street address", () => {
    expect(rowAddressLine({ ...base, property: { ...base.property!, address: "" } } as CleanerAppointment)).toBeNull();
  });
  it("returns null when there is no property", () => {
    expect(rowAddressLine({ ...base, property: null } as unknown as CleanerAppointment)).toBeNull();
  });
});

describe("googleMapsUrl / appleMapsUrl", () => {
  const addr = "8225 S Desert Bloom Dr, Phoenix, AZ 85044";
  it("googleMapsUrl encodes the address into a Google Maps search URL", () => {
    const url = googleMapsUrl(addr);
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=8225%20S%20Desert%20Bloom%20Dr%2C%20Phoenix%2C%20AZ%2085044",
    );
  });
  it("appleMapsUrl encodes the address and starts with https://maps.apple.com/?q=", () => {
    const url = appleMapsUrl(addr);
    expect(url.startsWith("https://maps.apple.com/?q=")).toBe(true);
    expect(url).toBe(
      "https://maps.apple.com/?q=8225%20S%20Desert%20Bloom%20Dr%2C%20Phoenix%2C%20AZ%2085044",
    );
  });
  it("appleMapsUrl encodes spaces and commas", () => {
    expect(appleMapsUrl("123 Main St, Austin, TX")).toContain("%20");
    expect(appleMapsUrl("123 Main St, Austin, TX")).toContain("%2C");
  });
  it("mapsUrl delegates to googleMapsUrl (same output)", () => {
    const expected = googleMapsUrl("123 Main St, Austin, TX 78701");
    expect(mapsUrl(base)).toBe(expected);
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

describe("formatCardDate", () => {
  it("returns null for today (date is implied)", () => {
    expect(formatCardDate("2026-06-10", "2026-06-10")).toBeNull();
  });
  it("formats a non-today date as weekday + month + day", () => {
    expect(formatCardDate("2026-07-01", "2026-06-10")).toBe("Wed, Jul 1");
  });
  it("includes the year only when different from today's year", () => {
    expect(formatCardDate("2027-01-05", "2026-06-10")).toBe("Tue, Jan 5, 2027");
  });
  it("null on empty/invalid", () => {
    expect(formatCardDate("", "2026-06-10")).toBeNull();
  });
});

describe("formatJobWhen", () => {
  it("formats a date+time as compact weekday-month-day + time", () => {
    expect(formatJobWhen("2026-06-27", "14:00:00")).toBe("Sat, Jun 27 · 2:00 PM");
  });
  it("handles midnight (12:00 AM)", () => {
    expect(formatJobWhen("2026-07-01", "00:05:00")).toBe("Wed, Jul 1 · 12:05 AM");
  });
  it("always shows the date even when it is today", () => {
    // The result must contain a weekday abbreviation regardless of what today is.
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const result = formatJobWhen(`${y}-${m}-${d}`, "09:00:00");
    expect(result).toMatch(/^[A-Z][a-z]{2},/); // starts with "Mon,", "Tue,", etc.
  });
});

describe("offerSlotChipLabels", () => {
  it("shows time only when all slots share a date", () => {
    expect(
      offerSlotChipLabels([
        { slot_index: 0, scheduled_date: "2026-03-05", scheduled_time: "10:00:00" },
        { slot_index: 1, scheduled_date: "2026-03-05", scheduled_time: "14:00:00" },
      ]),
    ).toEqual(["10:00 AM", "2:00 PM"]);
  });
  it("shows date and time when slots span days", () => {
    expect(
      offerSlotChipLabels([
        { slot_index: 0, scheduled_date: "2026-03-05", scheduled_time: "10:00:00" },
        { slot_index: 1, scheduled_date: "2026-03-06", scheduled_time: "10:00:00" },
      ]),
    ).toEqual(["Thu, Mar 5 · 10:00 AM", "Fri, Mar 6 · 10:00 AM"]);
  });
  it("single slot is time only", () => {
    expect(
      offerSlotChipLabels([
        { slot_index: 0, scheduled_date: "2026-03-05", scheduled_time: "09:30:00" },
      ]),
    ).toEqual(["9:30 AM"]);
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
