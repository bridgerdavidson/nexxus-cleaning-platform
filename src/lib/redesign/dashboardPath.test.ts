import { describe, expect, it } from "vitest";
import { getDashboardPath } from "./dashboardPath";

describe("getDashboardPath", () => {
  // Post-cutover (Phase 4, 4d): every role routes to its /app screen. The legacy
  // non-/app branches were removed and the `opts` param is kept only for
  // call-site compatibility (it's ignored).
  it("routes every role to its /app dashboard", () => {
    expect(getDashboardPath("admin")).toBe("/app/admin-dashboard");
    expect(getDashboardPath("manager")).toBe("/app/admin-dashboard");
    expect(getDashboardPath("cleaner")).toBe("/app/cleaner-dashboard");
    expect(getDashboardPath("homeowner")).toBe("/app/homeowner-dashboard");
  });

  it("ignores the retained-for-compat redesign opt", () => {
    expect(getDashboardPath("admin", { redesign: false })).toBe("/app/admin-dashboard");
    expect(getDashboardPath("cleaner", { redesign: true })).toBe("/app/cleaner-dashboard");
  });

  it("falls back to / for an unrecognized role", () => {
    expect(getDashboardPath("nonsense")).toBe("/");
  });
});
