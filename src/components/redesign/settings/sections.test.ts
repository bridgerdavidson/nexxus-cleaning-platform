// src/components/redesign/settings/sections.test.ts
import { describe, expect, it } from "vitest";
import type { ManagerPermissions } from "@/hooks/useAdminData";
import { deriveSettingsSections, isVisibleSection, REDESIGN_SETTINGS_SECTIONS } from "./sections";

const NONE: ManagerPermissions = {
  can_view_customers: false, can_edit_customers: false, can_view_bookings: false,
  can_edit_bookings: false, can_approve_decline_bookings: false, can_manage_cleaners: false,
  can_view_properties: false, can_edit_properties: false, can_view_analytics: false,
  can_view_payments: false, can_manage_payments: false, can_view_messages: false,
  can_view_services: false, can_manage_services: false, can_handle_requests: false,
};
const perms = (o: Partial<ManagerPermissions> = {}): ManagerPermissions => ({ ...NONE, ...o });
const ids = (role?: string, orgRole?: string, p?: ManagerPermissions) =>
  deriveSettingsSections(role, orgRole, p).map((s) => s.id);

describe("deriveSettingsSections", () => {
  it("owner sees all six sections", () => {
    expect(ids("admin", "owner")).toEqual([
      "profile", "organization", "payments", "cancellation", "payout", "business-hours",
    ]);
  });
  it("admin does not see owner-only sections (organization, payout)", () => {
    expect(ids("admin", "admin")).toEqual(["profile", "payments", "cancellation", "business-hours"]);
  });
  it("manager with no permissions sees only Profile", () => {
    expect(ids("manager", "manager", perms())).toEqual(["profile"]);
  });
  it("manager with can_manage_payments sees payments + cancellation", () => {
    expect(ids("manager", "manager", perms({ can_manage_payments: true }))).toEqual([
      "profile", "payments", "cancellation",
    ]);
  });
  it("manager with can_manage_cleaners sees business hours", () => {
    expect(ids("manager", "manager", perms({ can_manage_cleaners: true }))).toEqual([
      "profile", "business-hours",
    ]);
  });
  it("groups every section as account or business", () => {
    expect(REDESIGN_SETTINGS_SECTIONS.every((s) => s.group === "account" || s.group === "business")).toBe(true);
  });
});

describe("isVisibleSection", () => {
  it("payout is hidden from admins", () => {
    expect(isVisibleSection("payout", "admin", "admin")).toBe(false);
  });
  it("payout is visible to owners", () => {
    expect(isVisibleSection("payout", "admin", "owner")).toBe(true);
  });
});
