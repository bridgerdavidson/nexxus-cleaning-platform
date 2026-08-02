import { describe, it, expect } from "vitest";
import { isBrandedAppPath } from "./paths";

describe("isBrandedAppPath", () => {
  it("matches tenant app roots and their children", () => {
    expect(isBrandedAppPath("/admin")).toBe(true);
    expect(isBrandedAppPath("/admin/settings")).toBe(true);
    expect(isBrandedAppPath("/cleaner")).toBe(true);
    expect(isBrandedAppPath("/cleaner/messages")).toBe(true);
    expect(isBrandedAppPath("/homeowner")).toBe(true);
    expect(isBrandedAppPath("/homeowner/account")).toBe(true);
  });

  it("rejects platform, marketing, and auth surfaces", () => {
    expect(isBrandedAppPath("/")).toBe(false);
    expect(isBrandedAppPath("/login")).toBe(false);
    expect(isBrandedAppPath("/signup")).toBe(false);
    expect(isBrandedAppPath("/owner")).toBe(false);
    expect(isBrandedAppPath("/owner/tenants")).toBe(false);
    expect(isBrandedAppPath("/billing/add-card")).toBe(false);
  });

  it("is prefix-boundary safe", () => {
    expect(isBrandedAppPath("/administrator")).toBe(false);
    expect(isBrandedAppPath("/cleaners")).toBe(false);
    expect(isBrandedAppPath("/homeowners-guide")).toBe(false);
  });

  it("handles null/undefined/empty", () => {
    expect(isBrandedAppPath(null)).toBe(false);
    expect(isBrandedAppPath(undefined)).toBe(false);
    expect(isBrandedAppPath("")).toBe(false);
  });
});
