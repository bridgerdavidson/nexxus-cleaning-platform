import { describe, expect, it } from "vitest";
import { getDashboardPath } from "./dashboardPath";

describe("getDashboardPath", () => {
  it("maps legacy paths when redesign is off", () => {
    expect(getDashboardPath("admin")).toBe("/admin-dashboard");
    expect(getDashboardPath("manager")).toBe("/manager-dashboard");
    expect(getDashboardPath("cleaner")).toBe("/cleaner-dashboard");
    expect(getDashboardPath("homeowner")).toBe("/homeowner-dashboard");
    expect(getDashboardPath("nonsense")).toBe("/");
  });

  it("routes admin and cleaner to redesign screens when on", () => {
    expect(getDashboardPath("admin", { redesign: true })).toBe("/app/admin-dashboard");
    expect(getDashboardPath("cleaner", { redesign: true })).toBe("/app/cleaner-dashboard");
    // not-yet-built redesign screens still go to legacy to avoid dead-ends
    expect(getDashboardPath("manager", { redesign: true })).toBe("/manager-dashboard");
    expect(getDashboardPath("homeowner", { redesign: true })).toBe("/homeowner-dashboard");
  });
});
