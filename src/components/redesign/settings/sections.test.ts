// src/components/redesign/settings/sections.test.ts
import { describe, expect, it } from "vitest";
import type { ManagerPermissions } from "@/hooks/useAdminData";
import { deriveSettingsSections, isVisibleSection, REDESIGN_SETTINGS_SECTIONS } from "./sections";

const NONE: ManagerPermissions = {
  can_view_customers: false, can_edit_customers: false, can_view_bookings: false,
  can_edit_bookings: false, can_manage_cleaners: false,
  can_view_properties: false, can_edit_properties: false, can_view_analytics: false,
  can_view_payments: false, can_manage_payments: false, can_view_messages: false,
  can_view_services: false, can_manage_services: false, can_handle_requests: false,
};
const perms = (o: Partial<ManagerPermissions> = {}): ManagerPermissions => ({ ...NONE, ...o });
const ids = (role?: string, orgRole?: string, p?: ManagerPermissions) =>
  deriveSettingsSections(role, orgRole, p).map((s) => s.id);

describe("deriveSettingsSections", () => {
  // Updated in Task 9: "billing" was added directly after "payments". The exact
  // array is the point of this assertion (it is what catches a section leaking
  // to the wrong role), so it is updated rather than loosened.
  it("owner sees all nine sections", () => {
    expect(ids("admin", "owner")).toEqual([
      "profile", "appearance", "branding", "payments", "billing", "cancellation", "payout", "cleaner-experience", "business-hours",
    ]);
  });
  it("admin sees owner+admin sections but not owner-only (payout)", () => {
    expect(ids("admin", "admin")).toEqual([
      "profile", "appearance", "branding", "payments", "billing", "cancellation", "cleaner-experience", "business-hours",
    ]);
  });
  it("manager with no permissions sees only Profile and Appearance", () => {
    expect(ids("manager", "manager", perms())).toEqual(["profile", "appearance"]);
  });
  it("manager with can_manage_payments sees payments only (cancellation is owner/admin-only)", () => {
    expect(ids("manager", "manager", perms({ can_manage_payments: true }))).toEqual([
      "profile", "appearance", "payments",
    ]);
  });
  it("manager with can_manage_cleaners sees profile + appearance only (business-hours is owner/admin-only)", () => {
    expect(ids("manager", "manager", perms({ can_manage_cleaners: true }))).toEqual([
      "profile", "appearance",
    ]);
  });
  it("shows billing to owner and admin but not manager or cleaner", () => {
    expect(deriveSettingsSections(undefined, "owner").map((s) => s.id)).toContain("billing");
    expect(deriveSettingsSections(undefined, "admin").map((s) => s.id)).toContain("billing");
    expect(deriveSettingsSections(undefined, "manager", null).map((s) => s.id)).not.toContain("billing");
    expect(deriveSettingsSections(undefined, "cleaner").map((s) => s.id)).not.toContain("billing");
  });
  // A manager with every permission still never reaches billing: it is gated by
  // `roles`, not by a manager permission, so no permission can unlock it.
  it("never shows billing to a manager, whatever their permissions", () => {
    const all = Object.fromEntries(Object.keys(NONE).map((k) => [k, true])) as ManagerPermissions;
    expect(ids("manager", "manager", all)).not.toContain("billing");
  });
  it("groups every section as account or business", () => {
    expect(REDESIGN_SETTINGS_SECTIONS.every((s) => s.group === "account" || s.group === "business")).toBe(true);
  });
});

describe("isVisibleSection", () => {
  it("branding is visible to owners and admins but not managers", () => {
    expect(isVisibleSection("branding", "admin", "owner")).toBe(true);
    expect(isVisibleSection("branding", "admin", "admin")).toBe(true);
    expect(isVisibleSection("branding", "manager", "manager", NONE)).toBe(false);
  });
  it("billing is visible to owners and admins but not to a manager", () => {
    expect(isVisibleSection("billing", "admin", "owner")).toBe(true);
    expect(isVisibleSection("billing", "admin", "admin")).toBe(true);
    expect(isVisibleSection("billing", "manager", "manager", NONE)).toBe(false);
  });
  it("payout is hidden from admins", () => {
    expect(isVisibleSection("payout", "admin", "admin")).toBe(false);
  });
  it("payout is visible to owners", () => {
    expect(isVisibleSection("payout", "admin", "owner")).toBe(true);
  });
  it("cleaner-experience is visible to admins", () => {
    expect(isVisibleSection("cleaner-experience", "admin", "admin")).toBe(true);
  });
  it("cleaner-experience is visible to owners", () => {
    expect(isVisibleSection("cleaner-experience", "admin", "owner")).toBe(true);
  });
  it("cleaner-experience is hidden from a manager without permission", () => {
    expect(isVisibleSection("cleaner-experience", "manager", "manager", NONE)).toBe(false);
  });
});

// Task 9 context the brief flagged: `payments` already uses the CreditCard
// glyph. Two sections in the same nav group drawing the identical icon is a
// nav the eye cannot scan, and nothing else in the suite would catch it.
describe("section icons", () => {
  it("gives every section in a group a distinct icon", () => {
    for (const group of ["account", "business"] as const) {
      const icons = REDESIGN_SETTINGS_SECTIONS.filter((s) => s.group === group).map((s) => s.icon);
      expect(new Set(icons).size, group).toBe(icons.length);
    }
  });
  it("does not draw billing with the payments icon", () => {
    const icon = (id: string) => REDESIGN_SETTINGS_SECTIONS.find((s) => s.id === id)!.icon;
    expect(icon("billing")).not.toBe(icon("payments"));
  });
});
