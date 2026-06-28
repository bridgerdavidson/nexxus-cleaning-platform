import { describe, expect, it } from "vitest";
import { cleanerDisplayName, cleanerInitials, showAvailabilityPlaceholder } from "./deriveProfile";

describe("cleanerDisplayName", () => {
  it("joins first and last name", () => {
    expect(cleanerDisplayName({ firstName: "Maria", lastName: "Alvarez" })).toBe("Maria Alvarez");
  });
  it("falls back to first name when last is missing", () => {
    expect(cleanerDisplayName({ firstName: "Maria", lastName: "" })).toBe("Maria");
    expect(cleanerDisplayName({ firstName: "Maria", lastName: null })).toBe("Maria");
  });
  it("falls back to a generic label when both are empty", () => {
    expect(cleanerDisplayName({ firstName: "", lastName: "" })).toBe("Your profile");
    expect(cleanerDisplayName({})).toBe("Your profile");
  });
});

describe("cleanerInitials", () => {
  it("uses first + last initials, uppercased", () => {
    expect(cleanerInitials({ firstName: "maria", lastName: "alvarez" })).toBe("MA");
  });
  it("uses only the first initial when last is missing", () => {
    expect(cleanerInitials({ firstName: "Maria", lastName: null })).toBe("M");
  });
  it("falls back to U when no name", () => {
    expect(cleanerInitials({})).toBe("U");
  });
});

describe("showAvailabilityPlaceholder", () => {
  it("is true only for the employee (hourly_external) model", () => {
    expect(showAvailabilityPlaceholder("hourly_external")).toBe(true);
    expect(showAvailabilityPlaceholder("percentage_contractor")).toBe(false);
    expect(showAvailabilityPlaceholder(undefined)).toBe(false);
  });
});
