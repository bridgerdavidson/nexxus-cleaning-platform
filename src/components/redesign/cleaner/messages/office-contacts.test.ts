import { describe, it, expect } from "vitest";
import { filterOfficeContacts, resolvePrimaryOfficeContact } from "./office-contacts";
import type { OrganizationMember } from "@/hooks/useOrganizationMembers";

function m(over: Partial<OrganizationMember>): OrganizationMember {
  return {
    id: "u",
    email: "a@b.c",
    first_name: "A",
    last_name: "B",
    phone: null,
    role: "admin",
    avatar_url: null,
    org_role: "admin",
    ...over,
  };
}

describe("filterOfficeContacts", () => {
  it("keeps only admin/manager (the office), drops cleaners/homeowners", () => {
    const out = filterOfficeContacts([
      m({ id: "1", role: "admin" }),
      m({ id: "2", role: "manager" }),
      m({ id: "3", role: "cleaner" }),
      m({ id: "4", role: "homeowner" }),
    ]);
    expect(out.map((o) => o.id)).toEqual(["1", "2"]);
  });

  it("builds a display name from first+last, falling back to email then 'Office'", () => {
    expect(filterOfficeContacts([m({ id: "1", first_name: "Jordan", last_name: "Lee" })])[0].name).toBe("Jordan Lee");
    expect(
      filterOfficeContacts([m({ id: "2", first_name: null, last_name: null, email: "ops@x.co" })])[0].name,
    ).toBe("ops@x.co");
    expect(
      filterOfficeContacts([m({ id: "3", first_name: null, last_name: null, email: "" })])[0].name,
    ).toBe("Office");
  });
});

describe("resolvePrimaryOfficeContact", () => {
  it("prefers the org owner (org_role owner), then admin, then manager", () => {
    expect(
      resolvePrimaryOfficeContact([
        m({ id: "mgr", role: "manager", org_role: "manager" }),
        m({ id: "adm", role: "admin", org_role: "admin" }),
        m({ id: "own", role: "admin", org_role: "owner" }),
      ])?.id,
    ).toBe("own");
  });

  it("falls back to the first admin when there is no owner", () => {
    expect(
      resolvePrimaryOfficeContact([
        m({ id: "mgr", role: "manager", org_role: "manager" }),
        m({ id: "adm", role: "admin", org_role: "admin" }),
      ])?.id,
    ).toBe("adm");
  });

  it("falls back to a manager when there is no admin", () => {
    expect(
      resolvePrimaryOfficeContact([m({ id: "mgr", role: "manager", org_role: "manager" })])?.id,
    ).toBe("mgr");
  });

  it("returns null when there is no office contact", () => {
    expect(resolvePrimaryOfficeContact([m({ id: "c", role: "cleaner", org_role: "cleaner" })])).toBeNull();
  });
});
