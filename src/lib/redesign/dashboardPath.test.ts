import { describe, expect, it } from "vitest";
import { getDashboardPath } from "./dashboardPath";

describe("getDashboardPath", () => {
  // Post-cutover (Phase 4): every role routes to its top-level redesign shell.
  it("routes every role to its dashboard", () => {
    expect(getDashboardPath("admin")).toBe("/admin");
    expect(getDashboardPath("manager")).toBe("/admin");
    expect(getDashboardPath("cleaner")).toBe("/cleaner");
    expect(getDashboardPath("homeowner")).toBe("/homeowner");
  });

  it("falls back to / for an unrecognized role", () => {
    expect(getDashboardPath("nonsense")).toBe("/");
  });
});
