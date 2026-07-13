import { describe, it, expect } from "vitest";
import { toPropertyRowVM } from "./propertyRowVM";
import type { AdminProperty } from "@/hooks/useAdminData";

type PropertyOverrides = Omit<Partial<AdminProperty>, "owner_id"> & { owner_id?: string | null };

function baseProperty(overrides: PropertyOverrides = {}): AdminProperty {
  return {
    id: "prop-1",
    name: "Main house",
    address: "123 Main St",
    city: "Springfield",
    state: "IL",
    zip_code: "62704",
    bedrooms: 3,
    bathrooms: 2,
    square_feet: 1800,
    photo_url: null,
    archived_at: null,
    special_instructions: null,
    access_instructions: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    owner_id: "owner-1",
    homeowner: { id: "owner-1", first_name: "Jane", last_name: "Doe", email: "jane@example.com" },
    ...overrides,
  } as AdminProperty;
}

describe("toPropertyRowVM", () => {
  it("maps a homeowner-owned property to a joined owner name", () => {
    const vm = toPropertyRowVM(baseProperty());
    expect(vm.ownerLabel).toBe("Jane Doe");
    expect(vm.isOrgOwned).toBe(false);
    expect(vm.addressLine).toBe("123 Main St, Springfield, IL");
    expect(vm.detailsLabel).toBe("3 bd · 2 ba · 1,800 sf");
  });

  it("maps an org-owned property (owner_id null) to the Org-owned label", () => {
    const vm = toPropertyRowVM(baseProperty({ owner_id: null, homeowner: null }));
    expect(vm.ownerLabel).toBe("Org-owned");
    expect(vm.isOrgOwned).toBe(true);
  });

  it("still joins a name when the homeowner has no last name", () => {
    const vm = toPropertyRowVM(
      baseProperty({ homeowner: { id: "owner-1", first_name: "Jane", last_name: "", email: "jane@example.com" } }),
    );
    expect(vm.ownerLabel).toBe("Jane");
    expect(vm.isOrgOwned).toBe(false);
  });

  it("falls back to 'No details' when bedrooms/bathrooms/square_feet are all null", () => {
    const vm = toPropertyRowVM(baseProperty({ bedrooms: null, bathrooms: null, square_feet: null }));
    expect(vm.detailsLabel).toBe("No details");
  });
});
