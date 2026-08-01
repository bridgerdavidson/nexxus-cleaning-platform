import { describe, it, expect } from "vitest";
import { selectOrganization, type MembershipRow } from "./selectOrganization";

const a: MembershipRow = { organization_id: "aaa", role: "cleaner", created_at: "2026-01-02T00:00:00Z" };
const b: MembershipRow = { organization_id: "bbb", role: "owner", created_at: "2026-01-01T00:00:00Z" };

describe("selectOrganization", () => {
  it("returns null for no memberships", () => {
    expect(selectOrganization([], null)).toBeNull();
  });

  it("returns the only membership regardless of the remembered id", () => {
    expect(selectOrganization([a], "does-not-exist")?.organization_id).toBe("aaa");
  });

  it("honors a remembered org the user still belongs to", () => {
    expect(selectOrganization([a, b], "aaa")?.organization_id).toBe("aaa");
  });

  it("ignores a remembered org the user no longer belongs to", () => {
    expect(selectOrganization([a, b], "ccc")?.organization_id).toBe("bbb");
  });

  it("falls back to the oldest membership, not row order", () => {
    expect(selectOrganization([a, b], null)?.organization_id).toBe("bbb");
    expect(selectOrganization([b, a], null)?.organization_id).toBe("bbb");
  });

  it("breaks ties on organization_id so the result is never arbitrary", () => {
    const x: MembershipRow = { organization_id: "zzz", role: "owner", created_at: null };
    const y: MembershipRow = { organization_id: "aaa", role: "owner", created_at: null };
    expect(selectOrganization([x, y], null)?.organization_id).toBe("aaa");
    expect(selectOrganization([y, x], null)?.organization_id).toBe("aaa");
  });
});
