import { describe, expect, it } from "vitest";
import { deriveCleanerActive } from "./cleaner-nav-items";

describe("deriveCleanerActive", () => {
  it("resolves the Today root exactly", () => {
    expect(deriveCleanerActive("/cleaner")).toBe("today");
  });
  it("prefers the longest match for nested routes", () => {
    expect(deriveCleanerActive("/cleaner/schedule")).toBe("schedule");
    expect(deriveCleanerActive("/cleaner/earnings")).toBe("earnings");
  });
  it("returns undefined off-tree", () => {
    expect(deriveCleanerActive("/login")).toBeUndefined();
  });
});
