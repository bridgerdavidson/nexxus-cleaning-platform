import { describe, expect, it } from "vitest";
import { getDashboardPath } from "./dashboardPath";

describe("getDashboardPath", () => {
  // Post-cutover (Phase 4, 4d): every role routes to its /app screen. The legacy
  // non-/app branches were removed and the `opts` param is kept only for
  // call-site compatibility (it's ignored).
  it("routes every role to its /app dashboard", () => {
    expect(getDashboardPath("admin")).toBe("/admin");
    expect(getDashboardPath("manager")).toBe("/admin");
    expect(getDashboardPath("cleaner")).toBe("/cleaner");
    expect(getDashboardPath("homeowner")).toBe("/homeowner");
  });

  it("ignores the retained-for-compat redesign opt", () => {
    expect(getDashboardPath("admin", { redesign: false })).toBe("/admin");
    expect(getDashboardPath("cleaner", { redesign: true })).toBe("/cleaner");
  });

  it("falls back to / for an unrecognized role", () => {
    expect(getDashboardPath("nonsense")).toBe("/");
  });
});
