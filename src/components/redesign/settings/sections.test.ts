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
  it("owner sees all nine sections", () => {
    expect(ids("admin", "owner")).toEqual([
      "profile", "appearance", "organization", "branding", "payments", "cancellation", "payout", "cleaner-experience", "business-hours",
    ]);
  });
  it("admin sees owner+admin sections but not owner-only (organization, payout)", () => {
    expect(ids("admin", "admin")).toEqual([
      "profile", "appearance", "branding", "payments", "cancellation", "cleaner-experience", "business-hours",
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
