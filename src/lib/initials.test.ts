import { describe, it, expect } from "vitest";
import { personInitials } from "./initials";

describe("personInitials", () => {
  it("takes first letter of each name, uppercased", () => {
    expect(personInitials("David", "Reynolds")).toBe("DR");
  });
  it("handles a single name", () => {
    expect(personInitials("Madonna", "")).toBe("M");
    expect(personInitials(null, "Cher")).toBe("C");
  });
  it("returns empty string when no name", () => {
    expect(personInitials("", null)).toBe("");
  });
  it("trims whitespace", () => {
    expect(personInitials("  ada ", " lovelace ")).toBe("AL");
  });
});
