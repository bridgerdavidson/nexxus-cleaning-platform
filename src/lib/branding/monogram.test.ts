import { describe, it, expect } from "vitest";
import { orgInitials } from "./monogram";

describe("orgInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(orgInitials("Sparkle Clean")).toBe("SC");
  });
  it("takes two letters from a single word", () => {
    expect(orgInitials("Sparkle")).toBe("SP");
  });
  it("skips connector words", () => {
    expect(orgInitials("Maids of the Valley")).toBe("MV");
  });
  it("ignores leading and trailing whitespace", () => {
    expect(orgInitials("  Sparkle Clean  ")).toBe("SC");
  });
  it("falls back for an empty name", () => {
    expect(orgInitials("")).toBe("?");
  });
  it("handles a name that is only connector words", () => {
    expect(orgInitials("of the")).toBe("OF");
  });
});
