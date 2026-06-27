import { describe, expect, it } from "vitest";
import { deriveCleanerActive } from "./cleaner-nav-items";

describe("deriveCleanerActive", () => {
  it("resolves the Today root exactly", () => {
    expect(deriveCleanerActive("/app/cleaner-dashboard")).toBe("today");
  });
  it("prefers the longest match for nested routes", () => {
    expect(deriveCleanerActive("/app/cleaner-dashboard/schedule")).toBe("schedule");
    expect(deriveCleanerActive("/app/cleaner-dashboard/earnings")).toBe("earnings");
  });
  it("returns undefined off-tree", () => {
    expect(deriveCleanerActive("/login")).toBeUndefined();
  });
});
