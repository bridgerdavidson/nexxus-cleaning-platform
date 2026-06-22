import { describe, expect, it } from "vitest";
import {
  deriveCustomers,
  matchesCustomerSearch,
  sortCustomers,
  type CustomersCustomer,
} from "./deriveCustomers";

const cust = (over: Partial<CustomersCustomer> = {}): CustomersCustomer => ({
  first_name: "Jane",
  last_name: "Smith",
  email: "jane@example.com",
  phone: "555-0100",
  created_at: "2026-06-01T00:00:00Z",
  total_spent: 100,
  last_appointment_date: "2026-06-10",
  ...over,
});

describe("matchesCustomerSearch", () => {
  it("empty query matches everything", () => {
    expect(matchesCustomerSearch(cust(), "")).toBe(true);
    expect(matchesCustomerSearch(cust(), "   ")).toBe(true);
  });

  it("matches first/last name, email, and phone (case-insensitive)", () => {
    expect(matchesCustomerSearch(cust(), "jane")).toBe(true);
    expect(matchesCustomerSearch(cust(), "SMITH")).toBe(true);
    expect(matchesCustomerSearch(cust(), "example.com")).toBe(true);
    expect(matchesCustomerSearch(cust(), "555")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesCustomerSearch(cust(), "zzz")).toBe(false);
  });

  it("tolerates a missing name/phone (matches on email only)", () => {
    const noName = cust({ first_name: null, last_name: null, phone: null, email: "user@host.test" });
    expect(matchesCustomerSearch(noName, "jane")).toBe(false);
    expect(matchesCustomerSearch(noName, "host.test")).toBe(true);
  });
});

describe("sortCustomers", () => {
  const a = cust({ first_name: "Aaron", last_name: "Lee", created_at: "2026-01-01T00:00:00Z", total_spent: 50 });
  const b = cust({ first_name: "Beth", last_name: "Ng", created_at: "2026-03-01T00:00:00Z", total_spent: 300 });
  const c = cust({ first_name: "Cara", last_name: "Oh", created_at: "2026-02-01T00:00:00Z", total_spent: 150 });

  it("recent = newest created_at first", () => {
    expect(sortCustomers([a, b, c], "recent").map((x) => x.first_name)).toEqual(["Beth", "Cara", "Aaron"]);
  });

  it("name = A to Z by full name", () => {
    expect(sortCustomers([c, a, b], "name").map((x) => x.first_name)).toEqual(["Aaron", "Beth", "Cara"]);
  });

  it("spent = highest total first", () => {
    expect(sortCustomers([a, b, c], "spent").map((x) => x.first_name)).toEqual(["Beth", "Cara", "Aaron"]);
  });

  it("falls back to the email when no name is set (name sort)", () => {
    const noName = cust({ first_name: null, last_name: null, email: "aardvark@x.test" });
    expect(sortCustomers([b, noName], "name").map((x) => x.email)).toEqual(["aardvark@x.test", "jane@example.com"]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortCustomers(input, "spent");
    expect(input.map((x) => x.first_name)).toEqual(["Aaron", "Beth", "Cara"]);
  });
});

describe("deriveCustomers", () => {
  const jane = cust({ first_name: "Jane", last_name: "Smith", total_spent: 100, created_at: "2026-02-01T00:00:00Z" });
  const aaron = cust({
    first_name: "Aaron",
    last_name: "Lee",
    email: "aaron@acme.test",
    phone: "555-0200",
    total_spent: 500,
    created_at: "2026-05-01T00:00:00Z",
  });

  it("filters by search then sorts", () => {
    const out = deriveCustomers([jane, aaron], { search: "acme", sort: "recent" });
    expect(out).toHaveLength(1);
    expect(out[0].first_name).toBe("Aaron");
  });

  it("returns all when the search is empty, sorted by spend", () => {
    const out = deriveCustomers([jane, aaron], { search: "", sort: "spent" });
    expect(out.map((x) => x.first_name)).toEqual(["Aaron", "Jane"]);
  });
});
